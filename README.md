# ⏱ Timery --- Version 3.2.0

A Chrome extension (Manifest V3) for **timers, Pomodoro, Focus Mode, and
reminders**. It keeps running even after the browser is closed, displays
timers directly on web pages, and can also be controlled through
**Bale**.

------------------------------------------------------------------------

## ✨ Features

  -----------------------------------------------------------------------
  Feature                             Description
  ----------------------------------- -----------------------------------
  **Timers**                          Run multiple timers simultaneously
                                      with **progress rings**. Start a
                                      timer using `25 minutes` or `1:30`,
                                      choose from presets, pause/resume,
                                      or delete timers.

  **Timer Persistence**               Timers are powered by
                                      `chrome.alarms`. When a timer ends,
                                      a notification and sound are
                                      triggered---even when all tabs are
                                      closed.

  **Pomodoro**                        Focus and break cycles, today's
                                      session count, and automatic break
                                      start.

  **Focus Mode**                      Block distracting websites using
                                      `declarativeNetRequest` (Instagram,
                                      YouTube, etc.).

  **Bale Control**                    Users only need to provide their
                                      username. The `/timer`, `/list`,
                                      `/stop`, and `/status` commands can
                                      be executed through Bale.

  **Bot Identity**                    The bot's name and username are
                                      displayed in Settings. The **Test
                                      Send** button makes the bot send
                                      its own introduction message.

  **Web Overlay**                     A multi-timer overlay that can be
                                      dragged, minimized, or hidden, with
                                      a countdown displayed in the
                                      browser tab title.

  **Stopwatch**                       Start, stop, and resume without
                                      losing elapsed time; record laps;
                                      persistent state.

  **Reminders**                       Repeat once, daily, weekly,
                                      monthly, or yearly; enable/disable
                                      reminders; choose **Remind me in 5
                                      minutes** from notifications.

  **Date Tools**                      Accurate Solar Hijri ⇄ Gregorian
                                      date conversion, age calculation,
                                      and date-difference calculation.

  **Sync**                            Synchronization across devices
                                      using `chrome.storage.sync`.

  **Visual Polish**                   Icon badge, light/dark themes,
                                      toast notifications, and keyboard
                                      shortcuts.
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 📁 Project Structure

``` text
timery app-new-v29.7/
├── manifest.json          # MV3 — permissions and shortcuts
├── popup.html / popup.js  # User interface
├── style.css              # Design system + dark theme
├── service_worker.js      # Engine: alarms, notifications, Pomodoro, Focus Mode, Bale, sync
├── content_overlay.js     # Displays timers on web pages
├── offscreen.html/.js     # Plays alert sounds
├── js/
│   ├── config.js          # ⭐ Developer configuration (Worker URL + key)
│   ├── bale-messages.js   # ⭐ Bale message templates (visual cards)
│   ├── jalali.js          # Solar Hijri ⇄ Gregorian conversion (JDN)
│   └── utils.js           # Toasts, confirmation modals, formatting
├── worker/                # ⭐ Cloudflare Worker bridge for the Bale bot
│   ├── bale-worker.js     #   Message delivery, username detection, commands
│   ├── wrangler.toml
│   └── README.md          #   Complete deployment guide (for developers)
├── tests/                 # 45 unit tests + automated screenshot utility
└── shots/                 # Screenshots of the panels
```

------------------------------------------------------------------------

## 🚀 Installation (End Users)

1.  Open `chrome://extensions` and enable **Developer mode**.
2.  Click **Load unpacked** and select the project folder.
3.  Open the **Settings** tab → **Bale Bot** section → click **Generate
    Connection Code** → open the link in Bale.

> **Why use a connection code instead of a username?** Bale (like
> Telegram) does not allow bots to send private messages to users using
> only an `@username`. The bot receives the numeric `chat_id` only after
> the user sends `/start` themselves. The connection code automates this
> process. The server address and bot token are configured in the
> project and on Cloudflare.

### Keyboard Shortcuts

  Shortcut         Action
  ---------------- ------------------------------------------
  `Ctrl+Shift+5`   Start a quick 5-minute timer
  `Ctrl+Shift+2`   Start a quick 25-minute timer (Pomodoro)

------------------------------------------------------------------------

## ⭐ Bale Bot Setup (Developers Only)

The project uses a **"token behind a token"** architecture: the
extension contains only a *dummy key*, while the real bot token stays
securely behind Cloudflare.

``` js
// js/config.js
var TIMERY_CONFIG = {
  baleKey: 'TIMERY-A1B2C3',     // Dummy key (NOT the real bot token!)
  proxyUrl: 'https://timery-bale-relay.XXX.workers.dev',
  botUsername: '@timery_bot',
  ...
};
```

``` bash
cd worker
wrangler kv namespace create CHATS        # Required: stores username → chat_id mappings
wrangler secret put BALE_TOKEN           # Real bot token (Secret)
wrangler secret put TIMERY_KEYS          # Dummy keys: TIMERY-A1B2C3,TIMERY-D4E5F6
wrangler secret put WEBHOOK_SECRET       # Webhook route password
wrangler deploy
```

Then register the webhook once. Without this step, the server cannot
detect when a user sends `/start`:

``` bash
curl -X POST "https://timery-bale-relay.XXX.workers.dev/admin/webhook" \
  -H "x-timery-key: TIMERY-A1B2C3" -d '{}'
```

**End users only need to click one button:** **Generate Connection
Code** → the `ble.ir/<bot>?start=CODE` link opens → Bale sends
`/start CODE` → the numeric `chat_id` is stored, enabling reliable
message delivery from then on.

Full details: [`worker/README.md`](worker/README.md)

------------------------------------------------------------------------

## 🤖 Control via Bale

Users can send the following commands in the bot chat:

  Command                  Action
  ------------------------ ----------------------------------------
  `/timer 10m`             Start a 10-minute timer in the browser
  `/list`                  List active timers
  `/stop`                  Stop all timers
  `/status`                Show the full status
  `/remind 9:00 message`   Create a reminder

The extension fetches commands from the Worker every minute and sends
the responses back through Bale.

------------------------------------------------------------------------

## 🧪 Tests

``` bash
node tests/run.js         # 52 unit tests (dates, scheduling, commands)
node tests/direct-test.js # 20 direct Bale-mode tests (without a server)
node tests/worker-test.js # 33 Worker tests (authentication, code connection, delivery, commands)
node tests/make-preview.js
node tests/server.js      # http://localhost:8765/tests/preview.html
node tests/shots.js       # Automatically captures screenshots of all panels
node tests/preview-messages.js   # Previews Bale messages in the console
```

Test coverage includes Solar Hijri date conversion (leap years + 20-year
round trips), Persian/Latin duration parsing, and reminder scheduling.

------------------------------------------------------------------------

## 🔐 Security

-   The Bale bot token is **never included in the extension**; it is
    stored only as a Cloudflare Secret.
-   The **Store token in browser** option is intentionally not
    available.
-   The Worker enforces a rate limit of 60 messages per hour per user.
-   Messages are sent only to users who have initiated a conversation
    with the bot.

------------------------------------------------------------------------

## 👨‍💻 Developer

Hossein Khorram --- [GitHub](https://github.com/hkhoramir) ·
[Telegram](https://t.me/hkhoramir) · [Website](https://hkhoramir.ir)
