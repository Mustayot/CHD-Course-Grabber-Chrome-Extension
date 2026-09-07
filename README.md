[English](README.md) | [中文](README.zh-CN.md)
# CHD Course Grabber (Chrome Extension)

Automated course selection helper for Chang'an University's academic affairs system (bkjw.chd.edu.cn, Zhengfang EAMS).

> No login handling needed - the extension reuses your existing browser session.

## Features

- **Auto-scrape course list**: Fetch real lesson IDs, course codes, course numbers, teachers, and campuses from the election page
- **Real-time quota display**: Show `selected/capacity` for each lesson, full lessons highlighted in red
- **Multi-course priority**: Add multiple targets, grab in order, stop at the first success
- **Dual modes**:
  - ⚡ **Quick**: default 3s interval (adjustable), auto-degrades when full
  - 🕐 **Watch**: default 60s interval, ideal for long sessions before opening
- **Anti-ban backoff**: consecutive failures auto-lengthen interval (3s → 5s → 10s → 30s)
- **Auto-switch to watch mode**: when all targets are full, drops to 60s to avoid frequent requests
- **Clear feedback on every attempt**: ✅ success / ⛔ full / ❌ failed, shown in the panel + log
- **Notification**: sound + toast on success

## Installation (Developer Mode)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **"Load unpacked"**
4. Select this folder (`source/`)
5. Open the course election page - the 🎯 panel appears in the top-right corner

## Usage

1. Log in to the academic system and enter the course election page
   (`http://bkjw.chd.edu.cn/eams/stdElectCourse.action`)
2. Add target courses (two ways):
   - In the **Course Library** tab, search a course and click "+Target"
   - Or type directly: course code (e.g. `TB206001`), course number (e.g. `TB206001.08`), lesson ID (e.g. `420476`), or course name
3. Choose a mode: ⚡ Quick (3s) / 🕐 Watch (60s)
4. Click **Start** - it stops automatically with a notification when a course is grabbed

Targets are grabbed by priority (top to bottom); the first success stops the whole run.

## How It Works (APIs Used)

| Endpoint | Purpose |
|---|---|
| `GET /eams/stdElectCourse!data.action?profileId=<id>` | Course list (lesson IDs, course codes) |
| `GET /eams/stdElectCourse!queryStdCount.action?projectId=1&semesterId=262` | Selected/capacity count per lesson |
| `POST /eams/stdElectCourse!batchOperator.action?profileId=<id>&retakeDetail=` | Submit course election |

## Notes

- Use only with your **own** account and only for courses you actually need
- High request frequency may trigger school anti-abuse protection; default intervals are conservative
- The extension does not handle login; an active session is required

## License

For personal educational use only. Use responsibly and at your own risk.
