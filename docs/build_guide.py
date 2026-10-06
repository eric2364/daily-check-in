"""Rebuild the PDF using Python with reportlab installed: python docs/build_guide.py."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.enums import TA_LEFT

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf/daily-check-in-guide.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
FONT = Path('/usr/share/fonts/truetype/dejavu')
if FONT.exists():
    pdfmetrics.registerFont(TTFont('Body', str(FONT/'DejaVuSans.ttf')))
    pdfmetrics.registerFont(TTFont('Strong', str(FONT/'DejaVuSans-Bold.ttf')))
else:
    pdfmetrics.registerFontFamily('Helvetica', normal='Helvetica', bold='Helvetica-Bold')
BODY = 'Body' if FONT.exists() else 'Helvetica'
BOLD = 'Strong' if FONT.exists() else 'Helvetica-Bold'
pdfmetrics.registerFontFamily(BODY, normal=BODY, bold=BOLD)
W,H = 595.28,841.89
INK = HexColor('#18392e'); MUTED=HexColor('#52675f'); GREEN=HexColor('#217952'); PALE=HexColor('#eaf5ee')
c = canvas.Canvas(str(OUT), pagesize=(W,H))
c.setTitle('Daily Check-in - Your iPhone app explained')
c.setAuthor('Daily Check-in')
style=ParagraphStyle('body',fontName=BODY,fontSize=10.7,leading=16,textColor=INK,spaceAfter=10)
small=ParagraphStyle('small',parent=style,fontSize=9,leading=13,textColor=MUTED)
y=0

def para(text, s=style, x=48, width=W-96):
    global y
    p=Paragraph(text,s); _,h=p.wrap(width,H)
    if y-h<63: raise RuntimeError('Page overflow: '+text[:60])
    p.drawOn(c,x,y-h); y-=h+10

def heading(text):
    global y
    y-=8
    p=Paragraph(text,ParagraphStyle('head',fontName=BOLD,fontSize=14,leading=19,textColor=GREEN))
    _,h=p.wrap(W-96,H);p.drawOn(c,48,y-h);y-=h+10

def box(title,text):
    global y
    p=Paragraph(text,style);_,h=p.wrap(W-128,H)
    bh=h+48
    c.setFillColor(PALE);c.roundRect(48,y-bh,W-96,bh,10,fill=1,stroke=0)
    c.setFillColor(GREEN);c.setFont(BOLD,11);c.drawString(64,y-21,title)
    p.drawOn(c,64,y-35-h);y-=bh+15

def start(n,kicker,title,subtitle):
    global y
    c.setFillColor(GREEN);c.rect(0,H-10,W,10,fill=1,stroke=0)
    c.setFont(BOLD,9);c.drawString(48,H-48,kicker.upper())
    p=Paragraph(title,ParagraphStyle('title',fontName=BOLD,fontSize=26,leading=31,textColor=INK));_,h=p.wrap(W-96,H);p.drawOn(c,48,H-74-h)
    y=H-74-h-15
    para(subtitle,small)
    c.setStrokeColor(HexColor('#d9e5de'));c.line(48,48,W-48,48)
    c.setFillColor(MUTED);c.setFont(BODY,8);c.drawString(48,32,'DAILY CHECK-IN  |  v1.2.0  |  6 OCTOBER 2026')
    c.drawRightString(W-48,32,f'{n} / 8')

def finish(): c.showPage()
def link(title,url): return f'<link href="{url}" color="#217952"><u>{title}</u></link>'
APP='https://eric2364.github.io/daily-check-in/'
REPO='https://github.com/eric2364/daily-check-in'

start(1,'Your everyday journal','A small app, on your iPhone','A practical guide to logging, keeping your data safe, and understanding how a website becomes a personal app.')
para('Daily Check-in is a progressive web app (PWA): an interactive website that you can add to your Home Screen. You do not compile anything on your iPhone. GitHub builds the code and serves the app; your phone runs it.')
heading('Install once, then open the icon')
for t in ['1. Open '+link('Daily Check-in in Safari',APP)+' while connected to the internet.', '2. Tap <b>Share</b>, then <b>Add to Home Screen</b>. If available, enable <b>Open as Web App</b>. Tap <b>Add</b>.', '3. Open the new <b>Daily Check-in</b> icon. Let the first online load finish so the app can prepare its offline files.', '4. Use the installed app consistently. Safari and an installed web app may use different data containers.']:
    para(t)
box('No MacBook needed','For this app, a browser, GitHub repository, and hosting are enough. The app installs from a web link rather than the App Store.')
heading('What is included')
para('One editable daily record for perceived intake, weight, and optional cardio. Trends help you review what you have logged. History lets you revisit earlier dates. Settings provides CSV export, JSON backup/restore, and an optional cloud account for syncing between devices.')
para('App: '+link('Open Daily Check-in',APP)+'<br/>Source and version history: '+link('GitHub repository',REPO),small)
para('Installation reference: '+link('Apple: Turn a website into an app in Safari', 'https://support.apple.com/en-lamr/guide/iphone/iphea86e5236/ios'),small)
finish()

start(2,'Logging and reviewing','A check-in takes a moment','The date defaults to today in Hong Kong time. You can record a missed day, but future dates are not accepted.')
heading('Your daily fields')
para('<b>Perceived intake (1-5)</b> is your impression: very low, low, usual, high, or very high. It is not a calorie calculation. <b>Weight</b> is entered in kilograms.')
para('<b>Cardio:</b> choose Yes or No. If Yes, enter your own cardio type, minutes, and burned calories. The type can be walking, cycling, swimming, or any text that makes sense to you. Numbers are manually entered; the app does not measure activity or calculate calories.')
box('Example for 6 October','Intake: 3 (usual) | Weight: 70.2 kg<br/>Cardio: Yes | Type: Walking<br/>Minutes: 30 | Burned calories: 180 kcal<br/><br/>The 180 kcal value is an example input, not an estimate supplied by this app.')
heading('Saving and correcting')
para('Tap <b>Save check-in</b>. A date has one record: saving it again replaces that date\'s existing entry. Use <b>History → Edit</b> to change it. Blank fields mean not recorded; an explicit cardio No means you recorded no cardio.')
para('You can save an intake, weight, or cardio answer without filling every field. A cardio No can therefore be a useful check-in on its own. Previous records remain valid after the cardio update.')
heading('Reading trends')
para('Use the selected time range to review changes and logged days. Missing observations stay missing rather than becoming zero. The weight average uses the available weights within seven calendar days. Cardio summaries reflect only your entered values, so partial logs are a partial picture.')
finish()

start(3,'Your data','Where does the journal live?','The public code repository and your daily records are two different things. Choose local-only use or an optional cloud account.')
para('When you tap Save, JavaScript validates the entry and writes it to <b>IndexedDB</b>, a database managed by your browser on your phone. The database is called <b>daily-check-in</b>. It keeps the device journal, separate account records, and settings. Reopening normally reloads these records and draws the graphs.')
heading('Guest: a separate device journal')
para('Without signing in, entries stay local. They are not uploaded to GitHub or Supabase. Your existing logs remain in this guest journal after the cloud update. Signing in does not upload them automatically or merge them into another account.')
heading('Signed in: local plus cloud')
para('Entries saved while signed in are kept locally, then sent to your Supabase account when online. Sign in to that same account on another device to retrieve successfully synced entries. GitHub serves public app code; it does not receive the journal records.')
box('Two copies, when sync succeeds','Your phone has a working local copy. Supabase has the synced account copy. Guest entries and pending offline edits still have only the local copy until you explicitly copy or sync them.')
heading('Privacy and storage boundaries')
para('Account access is protected by login and database rules that restrict each user to their own records. The app does not add its own encryption to journal content. An unlocked phone or trusted web code at the same origin may access local records; keep control of your account and deployed code.')
para('An origin means protocol + hostname + port. The URL path is not a security boundary. Clearing browser storage can remove local data. Private browsing is unsuitable for a lasting journal. Keep JSON backups outside the app.')
para('References: '+link('MDN: Using IndexedDB','https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB')+'; '+link('MDN: Storage quotas and eviction','https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria'),small)
finish()

start(4,'Your cloud account','Sign in, then choose your data','An account is optional. You can keep using the app locally if cloud accounts are unavailable or you prefer local-only use.')
heading('Create an account or sign in')
para('In <b>Settings → Your cloud account</b>, choose <b>Create account</b>, enter your email and a password of at least six characters, then submit. Use a strong, unique password. If asked, open the email confirmation link; return to the app and sign in afterward.')
para('For an existing account, enter your email and password and tap <b>Sign in</b>. Your account journal appears separately from the guest device journal. New saves while signed in belong to this account.')
heading('Bring your previous device entries along')
para('First export a JSON backup of the guest journal. After signing in, use <b>Copy device journal to my account</b>, review the count, and choose <b>Confirm copy</b>. The guest journal is retained. You need a connection so the app can check the account before copying.')
para('If any date is already present in the account, the copy stops instead of silently replacing it. Review those dates manually. A deliberate JSON restore can replace matching dates after its preview and confirmation; keep a backup before doing so.')
heading('Forgotten password')
para('Use the password reset option with your account email. Open the recovery email link and follow <b>Choose a new password → Update password</b>. Email confirmation and password recovery depend on the project email service, not the offline cache.')
box('Current email delivery limitation','The default Supabase sender is for testing: recipients must be project organization team addresses, and it currently limits the project to two emails per hour. Other addresses require a configured custom SMTP service. A missing email may therefore be a service restriction, not an incorrect password.')
para('Reference: '+link('Supabase: Auth email and custom SMTP','https://supabase.com/docs/guides/auth/auth-smtp'),small)
finish()

start(5,'Sync and recovery','Know when the cloud is safe','Saving locally and successfully syncing to the server are separate steps.')
heading('Check the status in Settings')
para('While signed in, look for <b>Synced</b>, <b>0 pending changes</b>, and no conflicts. <b>Sync now</b> pulls account records and sends pending changes while online. The app also attempts sync when you return to it or regain a connection. It is not a continuously running background service.')
box('Before clearing data or changing phone','Connect to the internet, tap Sync now, and confirm there are no pending changes or unresolved conflicts. Export a JSON backup too. On the other device, sign in to the same account and sync to recover the server copy.')
para('Successfully synchronized records can be retrieved after browser data is cleared, as long as the account and cloud service remain available. <b>Unsynced offline edits and guest-only entries cannot be recovered from the cloud.</b> Clearing storage first can lose that work. The app blocks normal sign-out while changes or conflicts remain.')
heading('If two devices change the same date')
para('The app shows both versions instead of silently overwriting one. Compare <b>This device</b> with <b>Cloud</b>, then choose <b>Use this device</b> or <b>Use cloud</b>. That choice keeps one full record for the date; it does not combine fields. A deletion may be one of the versions.')
heading('Sync is not a historical backup')
para('Deleting an entry while signed in propagates the deletion to your account and other devices. Cloud sync gives continuity across devices, but it is not an independent archive of every previous version. Continue exporting JSON backups and CSV files periodically.')
para('Cloud journal sync and push reminders are separate services. The reminder service uses push subscriptions and reminder settings; its delivery setup has not been verified complete. Synced journal entries do not mean reminders are working.')
para('Access-control reference: '+link('Supabase: Row Level Security','https://supabase.com/docs/guides/database/postgres/row-level-security'),small)
finish()

start(6,'The website underneath','How HTML becomes an app','HTML supplies the starting document; JavaScript supplies the interactive behavior.')
para('<b>HTML</b> is the page skeleton and loads the app files. <b>CSS</b> controls colors, spacing, and responsive layout. <b>JavaScript</b> handles input, saving, exporting, and charts. This app uses React to construct the interface; Vite converts its source into deployable static files.')
# Simple vector architecture diagram
heading('The two flows')
def diagram_box(x,yy,w,h,title,detail):
    c.setFillColor(PALE);c.setStrokeColor(HexColor('#bed5c7'));c.roundRect(x,yy,w,h,8,fill=1,stroke=1)
    p=Paragraph('<b>'+title+'</b><br/>'+detail,small);_,ph=p.wrap(w-20,h);p.drawOn(c,x+10,yy+(h-ph)/2)
def arrow(x1,yy,x2):
    c.setStrokeColor(GREEN);c.setLineWidth(1.5);c.line(x1,yy,x2,yy);c.line(x2-5,yy+3,x2,yy);c.line(x2-5,yy-3,x2,yy)
y0=y-69
for x,t,d in [(48,'GitHub source','React + TS + CSS'),(218,'Build and host','Actions → Pages'),(388,'Your iPhone','Loads HTML/CSS/JS')]:diagram_box(x,y0,159,63,t,d)
arrow(208,y0+31,218);arrow(378,y0+31,388)
y=y0-24
para('ONLINE DELIVERY: files travel to the phone. Journal records are not sent to GitHub in this flow.',small)
y0=y-72
for x,t,d in [(48,'You tap Save','Input for one date'),(218,'JavaScript','Validate + store'),(388,'IndexedDB','Local journal data')]:diagram_box(x,y0,159,63,t,d)
arrow(208,y0+31,218);arrow(378,y0+31,388)
y=y0-24
para('LOCAL SAVE: phone storage. Signed-in entries also sync to Supabase when online; guest entries do not.',small)
heading('Why can it run offline?')
para('A <b>service worker</b> is a browser-managed helper. After a successful online installation, this app caches its HTML, JavaScript, CSS, icons, and fonts. Later it can load those files without downloading them again. This code cache is separate from the IndexedDB journal.')
para('Offline use depends on that initial cache being ready and retained. The service worker is not a program that can run continuously in the background; the browser controls when it starts and stops.')
para('Reference: '+link('MDN: Offline and background operation','https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation'),small)
finish()

start(7,'Backups and updates','Protect your entries','Choose the right export for what you want to do next.')
heading('CSV: for spreadsheets and analysis')
para('In <b>Settings → Export spreadsheet (CSV)</b>, save or share the file using the iPhone share sheet. Open it in Numbers, Excel, or Google Sheets. Each row is a date; columns include intake level, weight, cardio Y/N, type, minutes, and calories. Empty cells mean not recorded.')
para('CSV is an analysis export. This app does not restore from CSV. If you edit spreadsheet values, those changes do not automatically flow back into your journal.')
heading('JSON: for backup and restoration')
para('Use <b>Settings → Export backup</b> and save the JSON file to Files, iCloud Drive, or another safe location. This backup contains the currently viewed guest or account entries, not your password, reminder subscription, or settings. Keep dated copies, especially before deleting data, replacing your phone, or changing the app address.')
para('On the destination phone/app, choose <b>Restore from backup</b>, select the JSON file, review the preview, and confirm. Incoming dates replace matching dates; other dates remain. Version 1 backups from the older app are still accepted. New version 2 backups include cardio fields.')
box('A useful routine','Once a week: export a JSON backup.<br/>Before a risky change: export another backup.<br/>For charts outside the app: export CSV too.<br/>Check that Files really contains the saved files.')
heading('How the app updates')
para('A push to GitHub\'s main branch runs checks, builds the files, and deploys them to Pages. When you next go online, your browser can discover the new service worker. Save your current form, close all app/Safari windows for this app, and reopen to let the waiting update activate.')
para('An update at the same address does not intentionally erase the local journal. The cloud release keeps previous guest records and stores account records separately. Still, backup first: hosting changes and browser storage loss need explicit recovery from your JSON file.')
finish()

start(8,'Your next personal app','Is this a useful way forward?','Yes - for small personal tools with forms, local records, exports, and charts, a PWA is a practical approach.')
para('You can reuse the same pattern for a habit diary, expense log, reading tracker, symptom notes, or study planner: define a record, build an interface, save it locally, add export/restore, then host the static files. You can develop on Windows or Linux and install through Safari without a Mac or App Store release.')
heading('Choose the approach around the features')
# Compact comparison table made of wrapped cells
rows=[('Need','This PWA approach','Native iOS app'),('Manual logs and charts','Good fit; offline storage','Also suitable'),('Install and update','Web link + Home Screen','Apple build/distribution process'),('Cross-device journal sync','Available with Supabase login','Needs a sync design too'),('Apple Health / continuous tracking','Not provided by this app','Native APIs may be needed')]
from reportlab.platypus import Table,TableStyle
cells=[[Paragraph(t,small) for t in row] for row in rows]
t=Table(cells,colWidths=[145,174,180]);t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),PALE),('VALIGN',(0,0),(-1,-1),'TOP'),('LINEBELOW',(0,0),(-1,-1),.5,HexColor('#d9e5de')),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9)]));_,th=t.wrap(W-96,H);t.drawOn(c,48,y-th);y-=th+18
para('This app does not read Apple Health, GPS workouts, or heart rate, and does not continuously measure exercise in the background. Burned calories are your input. Reliable scheduled push reminders require the separate backend plus device permission and testing; a cached page alone cannot guarantee a daily alert.')
heading('A simple development recipe')
para('1. Start with the smallest useful form and one clear data model.<br/>2. Decide whether local-only data is enough; add backups early.<br/>3. Test saving, reopening, offline use, and restoration on the actual phone.<br/>4. Publish a version, keep its history in GitHub, and make small updates.')
para('Further reading: '+link('MDN: What is a progressive web app?','https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/What_is_a_progressive_web_app'),small)
para('This guide describes the project implementation at v1.2.0. iPhone menus and browser capabilities can vary with iOS versions. Use the linked primary documentation for current platform guidance.',small)
finish()
c.save()
print(OUT)
