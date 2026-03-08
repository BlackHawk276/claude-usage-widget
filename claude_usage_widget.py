#!/usr/bin/env python3
"""
Claude Code Usage Widget - macOS Floating Overlay
Shows real-time Claude API rate limit consumption (5-hour, weekly, Sonnet limits).
Sits as a small always-on-top widget in the corner of your screen.
"""

import json
import os
import subprocess
import threading
import time
import tkinter as tk
from datetime import datetime
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

# ── Config ───────────────────────────────────────────────────────────────────
REFRESH_INTERVAL_SEC = 300   # 5 minutes
WIDGET_OPACITY = 0.92

# Core palette
BG_COLOR = "#0e0e0e"          # page background (near black)
CARD_BG = "#161616"           # card background
BORDER_COLOR = "#252525"      # borders
GOLD = "#c9a84c"              # gold accent (signature color)
GOLD_BRIGHT = "#d4a843"       # brighter gold

# Text
TEXT_COLOR = "#e0e0e0"        # primary text (warm white)
BODY_COLOR = "#cccccc"        # body text
DIM_COLOR = "#888888"         # secondary text

# Progress bar colors
BAR_BG = "#2a2a2a"
GREEN = "#22c55e"
YELLOW = "#eab308"
ORANGE = "#f97316"
RED = "#ef4444"

WIDGET_WIDTH = 300
CORNER_PADDING = 20           # px from screen edge


# ── Helpers ──────────────────────────────────────────────────────────────────

def read_oauth_token():
    """Read Claude Code OAuth token from macOS Keychain."""
    try:
        result = subprocess.run(
            ["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            return None
        data = json.loads(result.stdout.strip())
        return data.get("claudeAiOauth")
    except Exception:
        return None


def read_subscription_info():
    """Read subscription info from ~/.claude.json."""
    try:
        with open(os.path.expanduser("~/.claude.json")) as f:
            account = json.load(f).get("oauthAccount", {})
        return {
            "name": account.get("displayName", ""),
            "sub": account.get("billingType", ""),
        }
    except Exception:
        return {}


def format_epoch_relative(epoch_str):
    """Format a unix epoch to relative time."""
    try:
        diff = int(epoch_str) - time.time()
        if diff <= 0:
            return "now"
        if diff < 60:
            return f"{int(diff)}s"
        if diff < 3600:
            return f"{int(diff / 60)}m"
        h, m = int(diff / 3600), int((diff % 3600) / 60)
        return f"{h}h {m}m"
    except (ValueError, TypeError):
        return "?"


def pct_color(pct):
    """Return color based on percentage."""
    if pct < 50:
        return GREEN
    if pct < 75:
        return YELLOW
    if pct < 90:
        return ORANGE
    return RED


# ── API Client ───────────────────────────────────────────────────────────────

class UsageFetcher:
    def __init__(self):
        self.usage = {}
        self.error = None
        self.last_updated = None

    def fetch(self):
        """Make a minimal API call and parse unified rate-limit headers."""
        oauth = read_oauth_token()
        if not oauth:
            self.error = "No credentials - log in to Claude Code"
            return

        token = oauth.get("accessToken")
        if not token:
            self.error = "No access token"
            return

        if oauth.get("expiresAt", 0) / 1000 < time.time():
            self.error = "Token expired - open Claude Code"
            return

        try:
            body = json.dumps({
                "model": "claude-sonnet-4-6",
                "max_tokens": 1,
                "messages": [{"role": "user", "content": "."}],
            }).encode()

            req = Request(
                "https://api.anthropic.com/v1/messages",
                data=body, method="POST",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                    "anthropic-version": "2023-06-01",
                    "anthropic-beta": "oauth-2025-04-20",
                },
            )

            with urlopen(req, timeout=15) as resp:
                headers = {k.lower(): v for k, v in resp.getheaders()}
                self._parse(headers)
                self.error = None
                self.last_updated = datetime.now()

        except HTTPError as e:
            headers = {k.lower(): v for k, v in e.headers.items()}
            self._parse(headers)
            if e.code == 401:
                self.error = "Token expired"
            elif e.code == 429:
                self.error = "Rate limited!"
                self.last_updated = datetime.now()
            else:
                self.error = f"API error {e.code}"
        except URLError as e:
            self.error = f"Network error"
        except Exception as e:
            self.error = str(e)[:80]

    def _parse(self, h):
        """Parse anthropic-ratelimit-unified-* headers."""
        self.usage = {}

        for key, label in [
            ("5h", "5-Hour"),
            ("7d", "Weekly"),
            ("7d_sonnet", "Sonnet"),
        ]:
            util = h.get(f"anthropic-ratelimit-unified-{key}-utilization")
            if util is not None:
                self.usage[key] = {
                    "label": label,
                    "pct": float(util) * 100,
                    "status": h.get(f"anthropic-ratelimit-unified-{key}-status", ""),
                    "reset": h.get(f"anthropic-ratelimit-unified-{key}-reset", ""),
                }

        self.usage["_overall"] = h.get("anthropic-ratelimit-unified-status", "")


# ── Widget UI ────────────────────────────────────────────────────────────────

class UsageWidget:
    def __init__(self):
        self.fetcher = UsageFetcher()
        self.oauth = read_oauth_token()
        self.sub_info = read_subscription_info()

        self.root = tk.Tk()
        self.root.title("Claude Usage")
        self.root.overrideredirect(True)          # no title bar
        self.root.attributes("-topmost", True)    # always on top
        self.root.attributes("-alpha", WIDGET_OPACITY)
        self.root.configure(bg=BORDER_COLOR)
        self.root.resizable(False, False)

        # Position: top-right corner of screen
        screen_w = self.root.winfo_screenwidth()
        x = screen_w - WIDGET_WIDTH - CORNER_PADDING
        y = CORNER_PADDING + 30  # below menu bar
        self.root.geometry(f"{WIDGET_WIDTH}x400+{x}+{y}")

        # Make it draggable
        self._drag_data = {"x": 0, "y": 0}
        self.root.bind("<Button-1>", self._on_press)
        self.root.bind("<B1-Motion>", self._on_drag)

        # Build UI
        self._build_ui()

        # Initial fetch after UI is up
        self.root.after(500, self._refresh)

        # Periodic refresh
        self._schedule_refresh()

    def _on_press(self, event):
        self._drag_data["x"] = event.x
        self._drag_data["y"] = event.y

    def _on_drag(self, event):
        x = self.root.winfo_x() + event.x - self._drag_data["x"]
        y = self.root.winfo_y() + event.y - self._drag_data["y"]
        self.root.geometry(f"+{x}+{y}")

    def _build_ui(self):
        px = 14  # horizontal padding

        # Outer border frame
        border = tk.Frame(self.root, bg=BORDER_COLOR)
        border.pack(fill="both", expand=True, padx=1, pady=1)

        main = tk.Frame(border, bg=CARD_BG)
        main.pack(fill="both", expand=True)

        # ── Header row ──
        header_frame = tk.Frame(main, bg=CARD_BG)
        header_frame.pack(fill="x", padx=px, pady=(12, 0))

        tk.Label(
            header_frame, text="\u2666 Claude Usage", font=("SF Pro Display", 14, "bold"),
            fg=GOLD, bg=CARD_BG, anchor="w",
        ).pack(side="left")

        # Close button
        close_btn = tk.Label(
            header_frame, text="\u2715", font=("SF Pro Display", 12),
            fg=DIM_COLOR, bg=CARD_BG, cursor="pointinghand",
        )
        close_btn.pack(side="right")
        close_btn.bind("<Button-1>", lambda e: self.root.destroy())

        # Refresh button
        self.refresh_btn = tk.Label(
            header_frame, text="\u21BB", font=("SF Pro Display", 14),
            fg=DIM_COLOR, bg=CARD_BG, cursor="pointinghand",
        )
        self.refresh_btn.pack(side="right", padx=(0, 8))
        self.refresh_btn.bind("<Button-1>", lambda e: self._refresh())

        # ── Plan info ──
        plan_text = self._get_plan_text()
        self.plan_label = tk.Label(
            main, text=plan_text, font=("SF Pro Text", 10),
            fg=DIM_COLOR, bg=CARD_BG, anchor="w",
        )
        self.plan_label.pack(fill="x", padx=px, pady=(2, 8))

        # ── Separator ──
        tk.Frame(main, bg=BORDER_COLOR, height=1).pack(fill="x", padx=px, pady=0)

        # ── Limit bars ──
        self.bar_frames = {}
        for key, label in [("5h", "5-Hour Limit"), ("7d", "Weekly Limit"), ("sonnet", "Sonnet (Weekly)")]:
            frame = tk.Frame(main, bg=CARD_BG)
            frame.pack(fill="x", padx=px, pady=(8, 0))

            # Label row
            label_frame = tk.Frame(frame, bg=CARD_BG)
            label_frame.pack(fill="x")

            name_lbl = tk.Label(
                label_frame, text=label, font=("SF Pro Text", 11),
                fg=TEXT_COLOR, bg=CARD_BG, anchor="w",
            )
            name_lbl.pack(side="left")

            pct_lbl = tk.Label(
                label_frame, text="--%", font=("SF Mono", 11, "bold"),
                fg=DIM_COLOR, bg=CARD_BG, anchor="e",
            )
            pct_lbl.pack(side="right")

            # Progress bar (canvas)
            bar_h = 8
            bar_canvas = tk.Canvas(
                frame, height=bar_h, bg=BAR_BG,
                highlightthickness=0, bd=0,
            )
            bar_canvas.pack(fill="x", pady=(4, 0))

            # Detail label
            detail_lbl = tk.Label(
                frame, text="", font=("SF Pro Text", 9),
                fg=DIM_COLOR, bg=CARD_BG, anchor="w",
            )
            detail_lbl.pack(fill="x", pady=(3, 0))

            self.bar_frames[key] = {
                "name": name_lbl,
                "pct": pct_lbl,
                "canvas": bar_canvas,
                "detail": detail_lbl,
                "height": bar_h,
            }

        # ── Separator ──
        tk.Frame(main, bg=BORDER_COLOR, height=1).pack(fill="x", padx=px, pady=(10, 0))

        # ── Status row ──
        status_frame = tk.Frame(main, bg=CARD_BG)
        status_frame.pack(fill="x", padx=px, pady=(6, 0))

        self.status_label = tk.Label(
            status_frame, text="", font=("SF Pro Text", 9),
            fg=DIM_COLOR, bg=CARD_BG, anchor="w",
        )
        self.status_label.pack(side="left")

        # ── Error row ──
        self.error_label = tk.Label(
            main, text="", font=("SF Pro Text", 10),
            fg=RED, bg=CARD_BG, anchor="w",
        )
        self.error_label.pack(fill="x", padx=px, pady=(2, 0))

        # ── Updated row ──
        self.updated_label = tk.Label(
            main, text="Loading...", font=("SF Pro Text", 9),
            fg=DIM_COLOR, bg=CARD_BG, anchor="w",
        )
        self.updated_label.pack(fill="x", padx=px, pady=(2, 12))

    def _get_plan_text(self):
        parts = []
        if self.sub_info.get("name"):
            parts.append(self.sub_info["name"])
        if self.oauth:
            sub = (self.oauth.get("subscriptionType") or "").capitalize()
            tier = (self.oauth.get("rateLimitTier") or "")
            tier_nice = tier.replace("default_claude_", "").replace("_", " ").title()
            if sub:
                parts.append(f"{sub} ({tier_nice})")
        return " \u2022 ".join(parts) if parts else "Not logged in"

    def _refresh(self):
        """Fetch data in background thread, then update UI."""
        self.refresh_btn.configure(fg=GOLD_BRIGHT)
        threading.Thread(target=self._do_fetch, daemon=True).start()

    def _do_fetch(self):
        self.fetcher.fetch()
        # Schedule UI update on main thread
        self.root.after(0, self._update_ui)

    def _schedule_refresh(self):
        self.root.after(REFRESH_INTERVAL_SEC * 1000, self._on_timer)

    def _on_timer(self):
        self._refresh()
        self._schedule_refresh()

    def _update_ui(self):
        self.refresh_btn.configure(fg=DIM_COLOR)

        usage = self.fetcher.usage
        key_map = {"5h": "5h", "7d": "7d", "sonnet": "7d_sonnet"}

        for display_key, api_key in key_map.items():
            bf = self.bar_frames[display_key]
            data = usage.get(api_key)

            if data:
                pct = data["pct"]
                ip = int(pct)
                color = pct_color(pct)
                status_icon = "\u2713" if data["status"] == "allowed" else "\u2717"
                reset_rel = format_epoch_relative(data["reset"])

                bf["pct"].configure(text=f"{ip}%", fg=color)
                bf["detail"].configure(
                    text=f"{status_icon} {data['status']}  \u2022  resets in {reset_rel}"
                )

                # Draw progress bar with rounded feel
                canvas = bf["canvas"]
                canvas.delete("all")
                canvas.update_idletasks()
                w = canvas.winfo_width()
                h = bf["height"]
                if w > 0:
                    canvas.create_rectangle(0, 0, w, h, fill=BAR_BG, outline="")
                    fill_w = int(pct / 100.0 * w)
                    if fill_w > 0:
                        canvas.create_rectangle(0, 0, fill_w, h, fill=color, outline="")
            else:
                bf["pct"].configure(text="--%", fg=DIM_COLOR)
                bf["detail"].configure(text="no data")
                bf["canvas"].delete("all")

        # Overall status
        overall = usage.get("_overall", "")
        if overall:
            color = GOLD if overall == "allowed" else RED
            label = "allowed" if overall == "allowed" else "limited"
            self.status_label.configure(text=f"Status: {label}", fg=color)
        else:
            self.status_label.configure(text="")

        # Error
        if self.fetcher.error:
            self.error_label.configure(text=f"\u26A0 {self.fetcher.error}")
        else:
            self.error_label.configure(text="")

        # Updated timestamp
        if self.fetcher.last_updated:
            self.updated_label.configure(
                text=f"Updated: {self.fetcher.last_updated.strftime('%H:%M:%S')}"
            )

        # Re-read subscription (token may have refreshed)
        self.oauth = read_oauth_token()
        self.plan_label.configure(text=self._get_plan_text())

    def run(self):
        self.root.mainloop()


# ── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    UsageWidget().run()
