# פריסה לשרת ענן (VPS) עם HTTPS ודומיין

מדריך זה מקים את המערכת על שרת קבוע, נגיש **מכל מחשב בעולם**, עם חיבור מאובטח (HTTPS)
ודומיין משלך. האפליקציה היא Node.js טהור ללא תלויות — אין צורך ב‑`npm install`.

## מה צריך לפני שמתחילים

1. **שרת VPS** עם Ubuntu 22.04+ (לדוגמה Hetzner ~‎€4/חודש, DigitalOcean ~$6, Linode).
   בעת ההזמנה תקבלו **כתובת IP** ציבורית וסיסמת/מפתח כניסה.
2. **דומיין** (לדוגמה מ‑Namecheap/GoDaddy/Cloudflare). מחיר טיפוסי ~$10 לשנה.
3. **רשומת DNS**: אצל ספק הדומיין צרו רשומת **A** שמפנה את הדומיין (או תת‑דומיין כמו
   `inventory.yourdomain.com`) לכתובת ה‑IP של השרת. המתינו כמה דקות שההפניה תתעדכן.

## התקנה אוטומטית (הדרך המומלצת)

התחברו לשרת דרך SSH והריצו (החליפו את הדומיין וכתובת הריפו):

```bash
ssh root@<כתובת-ה-IP-של-השרת>

sudo DOMAIN=inventory.yourdomain.com \
     REPO=https://github.com/eliasaf450-prog/inventory.git \
     bash -c "$(curl -fsSL https://raw.githubusercontent.com/eliasaf450-prog/inventory/main/deploy/setup.sh)"
```

> אם הריפו פרטי, קודם `git clone` ידני ואז הריצו `sudo DOMAIN=... REPO=... bash deploy/setup.sh`.

הסקריפט מתקין Node.js 22, מתקין Caddy (שמנפיק תעודת HTTPS חינמית אוטומטית), מקים שירות
שמופעל מחדש לבד אם השרת מתאתחל, ומחבר את הדומיין. בסיום פתחו:

```
https://inventory.yourdomain.com
```

והתחברו עם `admin` / `admin123` — **החליפו סיסמה מיד דרך מסך המשתמשים**.

## מה קורה מאחורי הקלעים

| רכיב | תפקיד |
|------|-------|
| `inventory.service` | מריץ את האפליקציה כשירות מערכת; מקשיב על `127.0.0.1:3000` בלבד. |
| `Caddyfile` | reverse proxy שחושף את האפליקציה החוצה על 443 עם HTTPS אוטומטי. |
| `data/inventory.db` | מסד הנתונים (קובץ SQLite). **כל המידע נמצא כאן.** |

האפליקציה עצמה לא חשופה ישירות לאינטרנט — רק Caddy, וזה מה שמספק את האבטחה והצפנה.

## פעולות שוטפות

**עדכון לגרסה חדשה** (אחרי שדחפתם שינויים ל‑GitHub):
```bash
cd /opt/inventory && sudo git pull && sudo systemctl restart inventory
```

**צפייה בלוגים:**
```bash
sudo journalctl -u inventory -f
```

**גיבוי** (חשוב! המידע כולו בקובץ אחד):
```bash
sudo cp /opt/inventory/data/inventory.db ~/inventory-backup-$(date +%F).db
```

**הפעלה/עצירה ידנית:**
```bash
sudo systemctl restart inventory   # הפעלה מחדש
sudo systemctl stop inventory      # עצירה
```

## התקנה ידנית (אם מעדיפים בלי הסקריפט)

```bash
# 1. Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs git

# 2. הקוד
sudo git clone https://github.com/eliasaf450-prog/inventory.git /opt/inventory
sudo mkdir -p /opt/inventory/data

# 3. שירות systemd
sudo cp /opt/inventory/deploy/inventory.service /etc/systemd/system/
sudo systemctl enable --now inventory

# 4. Caddy ל-HTTPS
sudo apt-get install -y caddy
sudo sed 's/inventory.example.com/inventory.yourdomain.com/' \
     /opt/inventory/deploy/Caddyfile | sudo tee /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

## חלופה קלה למתחילים: Render (HTTPS אוטומטי, ללא ניהול שרת)

אם אתם לא רוצים לנהל שרת בעצמכם, **Render** היא הדרך הקלה ביותר: מתחברים ל‑GitHub,
מקבלים HTTPS אוטומטי, והנתונים נשמרים על דיסק קבוע. הפרויקט כבר כולל `render.yaml`.

1. הירשמו ב‑[render.com](https://render.com) והתחברו עם חשבון ה‑GitHub שלכם.
2. **New + → Blueprint**, בחרו את הריפו `inventory`. Render יקרא את `render.yaml` לבד.
3. אשרו את היצירה. בסיום תקבלו כתובת כמו `https://inventory.onrender.com`.
4. התחברו עם `admin` / `admin123` והחליפו סיסמה מיד.

> חשוב: ב‑`render.yaml` מוגדרת תוכנית `starter` כי **דיסק קבוע** (לשמירת הנתונים) זמין
> רק בתוכניות בתשלום. בתוכנית החינמית הנתונים נמחקים בכל פריסה/הפעלה מחדש.

> ⚠️ **Vercel לא מתאימה לאפליקציה זו.** Vercel היא serverless עם מערכת קבצים לקריאה
> בלבד והנתונים בה אינם נשמרים. השתמשו ב‑VPS (למעלה) או ב‑Render.

## פתרון תקלות

- **הדפדפן לא נטען / "אתר לא נמצא"** → בדקו שרשומת ה‑DNS (A) מצביעה ל‑IP הנכון, והמתינו
  כמה דקות. בדקו ש‑Caddy רץ: `sudo systemctl status caddy`.
- **שגיאת תעודת HTTPS** → ודאו שהדומיין כבר מצביע לשרת *לפני* הפעלת Caddy; Caddy צריך
  גישה לפורט 80/443. בדקו שאין חומת אש שחוסמת: `sudo ufw allow 80,443/tcp`.
- **האפליקציה לא עולה** → `sudo journalctl -u inventory -n 50` יראה את השגיאה. ודאו
  ש‑Node הוא לפחות גרסה 22.5 (`node --version`).
