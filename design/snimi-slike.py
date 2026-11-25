#!/usr/bin/env python3
"""Slike ekrana za redizajn (design/poslije/): SVE ekrane na 360, 390 i 430 px.

Upotreba (iz korijena repozitorija):
  1. Probna baza i API (nijedan produkcijski podatak se ne dira):
       createdb -h 127.0.0.1 -p 55432 -U postgres komodo_redizajn4
       cd api && DATABASE_URL=postgres://postgres@127.0.0.1:55432/komodo_redizajn4 PORT=3986 \
         ADMIN_EMAILS=admin@proba.ba node src/server.js &
  2. python3 design/snimi-slike.py --seed     (puni bazu: 5 butika, 24 oglasa, poruke; traži SEED_DIR s o1..o22.mp4 i oglasi.py)
  3. python3 design/snimi-slike.py            (snima slike u design/poslije/)
     python3 design/snimi-slike.py 390       (samo jedna veličina)

Okruženje: KOMODO_URL (http://127.0.0.1:3986), DATABASE_URL (probna baza), SEED_DIR (/tmp/dizajn-seed).
Chrome: /usr/bin/google-chrome, --lang=bs-BA, locale bs-BA i LANGUAGE=bs:hr (inače Chrome crta vrijeme kao „09:00 AM”).
Snimci koje seed i slike pošalju završe u api/uploads (ignorirano u gitu): obriši ih poslije.
"""
import os, sys, random, subprocess, json, datetime
from urllib.parse import urlparse

B = os.environ.get('KOMODO_URL', 'http://127.0.0.1:3986')
DB = os.environ.get('DATABASE_URL', 'postgres://postgres@127.0.0.1:55432/komodo_redizajn4')
SEED = os.environ.get('SEED_DIR', '/tmp/dizajn-seed')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, 'poslije') + '/'
PW = 'lozinka123'
SIZES = [(360, 780), (390, 844), (430, 932)]
USERS = {'kupac': 'amra@proba.ba', 'b0': 'bojana@proba.ba', 'admin': 'admin@proba.ba', 'gost': None}
DUGI_BUTIK = 'Butik Elegancija i Stil Gospodske Ulice Banja Luka'
DUGI_NAZIV = 'Dugačka vunena zimska jakna s kapuljačom od prave vune, kamel, ručni rad, vrhunski kvalitet'  # 91 znak; server čuva 60

def psql(sql):
    return subprocess.run(['psql', DB, '-tAc', sql], capture_output=True, text=True, check=True).stdout.strip()

def clr():
    subprocess.run(['psql', DB, '-qc', 'delete from rate_limits'], capture_output=True)

# ------------------------------------------------------------------ seed
def seed():
    import requests
    sys.path.insert(0, SEED)
    from oglasi import OGLASI
    def sh(cmd): subprocess.run(cmd, shell=True, check=True, capture_output=True)
    # skoro bijeli i šareni snimak
    sh('ffmpeg -y -loglevel error -f lavfi -i color=c=0xFAFAF7:s=720x1280:d=3:r=25 -pix_fmt yuv420p -c:v libx264 /tmp/_bijeli.mp4')
    sh('ffmpeg -y -loglevel error -f lavfi -i testsrc2=s=720x1280:d=3:r=25 -pix_fmt yuv420p -c:v libx264 /tmp/_sareni.mp4')
    def reg(name, email):
        s = requests.Session()
        r = s.post(B + '/api/auth/register', json={'name': name, 'email': email, 'password': PW})
        assert r.status_code in (201, 409), r.text
        if r.status_code == 409: login(s, email)
        return s
    def login(s, email):
        r = s.post(B + '/api/auth/login', json={'email': email, 'password': PW}); assert r.ok, r.text
    env = dict(os.environ, DATABASE_URL=DB)
    for naziv, email in [('Moda Bojana', 'bojana@proba.ba'), ('Butik Lana', 'lana@proba.ba'), ('Kaldrma Shoes', 'kaldrma@proba.ba'),
                         ('Torbica BL', 'torbica@proba.ba'), (DUGI_BUTIK, 'elegancija@proba.ba')]:
        subprocess.run(['node', 'src/novi-butik.js', '--butik', naziv, '--email', email], cwd=os.path.join(ROOT, 'api'), env=env, check=True, capture_output=True)
    reg('Admin', 'admin@proba.ba')
    kupac = reg('Amra Kovačević', 'amra@proba.ba')
    ostali = [reg(n, e) for n, e in [('Jelena Savić', 'jelena@proba.ba'), ('Nikola Marić', 'nikola@proba.ba'), ('Sara Babić', 'sara@proba.ba'),
                                      ('Milica Đurić', 'milica@proba.ba'), ('Dejan Popović', 'dejan@proba.ba')]]
    h = psql("select password_hash from users where email='amra@proba.ba'")
    psql(f"update users set password_hash='{h}', created_at = now() - interval '40 days' where role='butik'")
    info = {
        'bojana': ('bojana@proba.ba', 'Moda Bojana', '065 123 456', 'Kralja Petra I Karađorđevića 85', {'rd': ['09:00', '20:00'], 'sub': ['09:00', '15:00'], 'ned': None}, ['instagram.com/moda.bojana', 'facebook.com/modabojana']),
        'lana': ('lana@proba.ba', 'Butik Lana', '066 234 567', 'Gospodska 14', {'rd': ['10:00', '21:00'], 'sub': ['10:00', '18:00'], 'ned': None}, ['instagram.com/butik.lana', 'tiktok.com/@butiklana']),
        'kaldrma': ('kaldrma@proba.ba', 'Kaldrma Shoes', '065 987 321', 'Veselina Masleše 6', {'rd': ['08:30', '20:00'], 'sub': ['09:00', '16:00'], 'ned': ['10:00', '14:00']}, ['instagram.com/kaldrma.shoes', 'kaldrma.ba']),
        'torbica': ('torbica@proba.ba', 'Torbica BL', '066 555 010', 'TC Delta Planet, Bulevar srpske vojske 8', {'rd': ['09:00', '22:00'], 'sub': ['09:00', '22:00'], 'ned': ['10:00', '20:00']}, ['instagram.com/torbica.bl']),
        'elegancija': ('elegancija@proba.ba', DUGI_BUTIK, '065 000 111', 'Ulica Kralja Alfonsa XIII broj 147, lamela B, prizemlje', {'rd': ['09:00', '20:00'], 'sub': ['09:00', '15:00'], 'ned': None}, ['instagram.com/elegancija']),
    }
    shops = {}
    for k, (email, name, phone, adr, hrs, links) in info.items():
        s = requests.Session(); login(s, email); shops[k] = s
        r = s.patch(B + '/api/me', json={'name': name, 'phone': phone, 'address': adr, 'hours': hrs, 'links': links}); assert r.ok, r.text
    ids = []
    def objavi(s, naziv, cijena, kat, vel, video):
        with open(video, 'rb') as f:
            data = {'title': naziv, 'price': cijena, 'category': kat}
            if vel: data['sizes'] = ','.join(vel)
            r = s.post(B + '/api/listings', data=data, files={'video': (os.path.basename(video), f, 'video/mp4')})
        assert r.ok, (naziv, r.text)
        return r.json()['oglas']['id']
    for idx, o in enumerate(OGLASI):
        naziv, cij, stara, kat, vel, butik = o[:6]
        lid = objavi(shops[butik], naziv, stara or cij, kat, vel, f'{SEED}/o{idx+1}.mp4'); ids.append(lid)
        if stara:
            psql(f"update listings set price_cents={int(cij)*100}, old_price_cents={int(stara)*100}, price_dropped_at=now()-interval '1 day', price_set_at=now()-interval '1 day' where id={lid}")
    for n, lid in enumerate(ids):
        psql(f"update listings set created_at = now() - interval '{(len(ids)-n)*7} hours' where id={lid}")
    psql(f"update listings set sold=true, sold_at=now()-interval '3 hours' where id={ids[10]}")
    # slučajevi iz pregleda: dug naziv + dugo ime butika + sniženje >= 1.000 KM + 6 veličina; skoro bijeli i šareni snimak
    sp = {}
    sp['dugo'] = objavi(shops['elegancija'], DUGI_NAZIV, '1499,90', 'Jakne i kaputi', ['XS', 'S', 'M', 'L', 'XL', 'XXL'], '/tmp/_bijeli.mp4')
    psql(f"update listings set price_cents=124990, old_price_cents=149990, price_dropped_at=now(), price_set_at=now() where id={sp['dugo']}")
    sp['svijetli'] = objavi(shops['bojana'], 'Bijela lanena košulja', '49', 'Majice i košulje', ['S', 'M'], '/tmp/_bijeli.mp4')
    sp['sareno'] = objavi(shops['torbica'], 'Šarena torba, ručni rad', '35', 'Torbe', None, '/tmp/_sareni.mp4')
    for k, lid in sp.items(): psql(f"update listings set created_at = now() - interval '1 hour' where id={lid}")
    random.seed(4)
    svi = [kupac] + ostali
    for s in svi:
        for lid in random.sample(ids, 7): s.post(B + f'/api/listings/{lid}/like', json={'liked': True})
    for s, hs in zip(svi, [['moda.bojana', 'kaldrma.shoes'], ['moda.bojana', 'butik.lana'], ['moda.bojana'], ['kaldrma.shoes', 'torbica.bl'], ['butik.lana', 'moda.bojana'], ['moda.bojana']]):
        for hnd in hs: s.post(B + f'/api/shops/{hnd}/follow', json={'following': True})
    psql("""insert into listing_views(listing_id, viewer, day) select l.id, 'v'||g||'-'||l.id, current_date - (g % 14)
      from listings l, generate_series(1, 40 + (l.id*37 % 90)) g on conflict do nothing""")
    psql("update listings l set views = (select count(*) from listing_views v where v.listing_id=l.id)")
    def razgovor(s, shop, lid, poruke, shop_s, odgovori):
        r = s.post(B + '/api/conversations', json={'shop': shop, 'listingId': lid}); assert r.ok, r.text
        cid = r.json()['razgovor']
        for p in poruke: assert s.post(B + f'/api/conversations/{cid}/messages', json={'body': p}).ok
        for p in odgovori: assert shop_s.post(B + f'/api/conversations/{cid}/messages', json={'body': p}).ok
        return cid
    c1 = razgovor(kupac, 'moda.bojana', ids[0], ['Dobar dan! Da li je haljina još dostupna u M?'], shops['bojana'], ['Zdravo Amra, jeste! Imamo M i L. Možete svratiti do 20h.'])
    kupac.post(B + f'/api/conversations/{c1}/messages', json={'body': 'Super, svratiću danas poslije posla. Hvala!'})
    razgovor(kupac, 'kaldrma.shoes', ids[13], ['Koji je broj najmanji koji imate za tene?'], shops['kaldrma'], ['Imamo od 36. Za 35 možemo naručiti za 3 dana.'])
    razgovor(ostali[0], 'moda.bojana', ids[2], ['Koliko je dug kaput? Ja sam 170 cm.'], shops['bojana'], [])
    razgovor(ostali[2], 'moda.bojana', ids[1], ['Može li rezervacija do subote?'], shops['bojana'], [])
    # razgovor s dugim imenom butika i porukama od prije nekoliko dana (razdjelnik dana)
    handle_dugo = psql("select handle from users where email='elegancija@proba.ba'")
    c5 = razgovor(kupac, handle_dugo, sp['dugo'], ['Imate li jaknu u veličini M?'], shops['elegancija'], ['Imamo, dostupna je.'])
    psql(f"update messages set created_at = now() - interval '3 days' where conversation_id={c5} and id=(select min(id) from messages where conversation_id={c5})")
    psql(f"update messages set created_at = now() - interval '1 day' where conversation_id={c5} and id=(select max(id) from messages where conversation_id={c5})")
    psql("insert into listing_contacts(listing_id, customer_id) select l.id, u.id from listings l, users u where u.role='kupac' and (l.id+u.id) % 4 = 0 on conflict do nothing")
    kupac.post(B + '/api/reports', json={'listingId': ids[19], 'reason': 'Prevara ili lažan oglas'})
    json.dump({'ids': ids, 'handle_dugo': handle_dugo, **sp, 'razgovor_dugo': c5}, open('/tmp/_slike-seed.json', 'w'))
    print('seed gotov', ids, sp)

if __name__ == '__main__' and '--seed' in sys.argv:
    seed(); sys.exit(0)

# ------------------------------------------------------------------ slike
def snimi(only_w=None):
    from playwright.sync_api import sync_playwright
    S = json.load(open('/tmp/_slike-seed.json'))
    IDS = S['ids']; DUGO, SVIJETLI, SARENO = S['dugo'], S['svijetli'], S['sareno']
    VIDEO = f'{SEED}/o2.mp4'
    tz = 'Europe/Sarajevo'
    with sync_playwright() as p:
        for (w, h) in SIZES:
            if only_w and w != only_w: continue
            br = p.chromium.launch(executable_path='/usr/bin/google-chrome',
                                   args=['--no-sandbox', '--lang=bs-BA', '--accept-lang=bs-BA,bs', '--autoplay-policy=no-user-gesture-required'],
                                   # Bez LANGUAGE Chrome na ovom Linuxu crta vrijeme kao „09:00 AM”; s bs:hr crta 24-satno kao na telefonu s bosanskim jezikom
                                   env=dict(os.environ, LANGUAGE='bs:hr', LC_ALL='C.UTF-8'))
            def ctx(role='gost', uputa=True, sat='podne'):
                c = br.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='bs-BA', timezone_id=tz)
                if uputa: c.add_init_script("try{localStorage.setItem('komodo.uputa','1')}catch(e){}")
                clr()
                if USERS[role]:
                    r = c.request.post(B + '/api/auth/login', data={'email': USERS[role], 'password': PW}); assert r.ok, r.text()
                pg = c.new_page(); pg.on('pageerror', lambda e: print('PAGEERROR', w, e))
                # Sat klijenta je zadan da slike ne zavise od doba dana: radni dan u 12:00 (butici otvoreni) ili 07:30 (zatvoreni)
                pg.clock.install(time=podne if sat == 'podne' else sat)
                return c, pg
            def shot(pg, role, name, wait=700, full=False):
                pg.wait_for_timeout(wait)
                pg.screenshot(path='%s%d-%s-%s.png' % (OUT, w, role, name), full_page=full)
            def step(name, f):
                try: f()
                except Exception as e: print(w, name, 'GRESKA', str(e)[:300])
            def home(pg, sel='.card .cta'):
                pg.goto(B + '/'); pg.wait_for_selector(sel); pg.wait_for_timeout(900)
            def oglas(pg, lid):
                pg.goto(B + '/?o=%d' % lid); pg.wait_for_selector('.card[data-id]'); pg.wait_for_timeout(1000)
            danas = datetime.datetime.now()
            jutro = danas.replace(hour=7, minute=30, second=0, microsecond=0)
            while jutro.weekday() > 4: jutro += datetime.timedelta(days=1)  # radni dan, prije otvaranja
            podne = jutro.replace(hour=12, minute=0)

            # ---------------- gost
            c, pg = ctx('gost')
            home(pg); shot(pg, 'gost', 'feed-zatebe', 500)
            step('novo', lambda: (pg.click('.ftab[data-k=novo]'), shot(pg, 'gost', 'feed-novo', 1200)))
            step('praceni', lambda: (pg.click('.ftab[data-k=praceni]'), shot(pg, 'gost', 'feed-praceni', 900)))
            home(pg); step('kontakt', lambda: (pg.click('.card .cta'), shot(pg, 'gost', 'kontakt', 500)))
            home(pg); step('filter', lambda: (pg.click('#searchToggle'), shot(pg, 'gost', 'filter', 500)))
            def filter_prazno():
                home(pg); pg.click('#searchToggle'); pg.fill('#qText', 'nepostojeci proizvod'); pg.click('#searchForm button[type=submit]'); shot(pg, 'gost', 'filter-prazno', 1200)
            step('filter-prazno', filter_prazno)
            def filter_velicina():  # D-11: aktivni filter veličine ostaje vidljiv kad je red kategorija pomjeren
                home(pg); pg.click('#searchToggle'); pg.click('#qSizesOdjeca [data-size=M]'); pg.click('#searchForm button[type=submit]'); pg.wait_for_timeout(900)
                pg.evaluate("document.querySelector('#chips .chips-scroll').scrollLeft=99999"); shot(pg, 'gost', 'feed-filter-velicina', 500)
                assert pg.evaluate("document.querySelector('.vtab').getBoundingClientRect().left") >= 0, 'vtab van ekrana'
            step('filter-velicina', filter_velicina)
            def kat_prazna():
                home(pg); pg.click('.chip[data-cat="Ostalo"]'); shot(pg, 'gost', 'feed-kategorija-prazna', 1200)
            step('kat-prazna', kat_prazna)
            def srce():
                home(pg); pg.click('.card .act[data-act=like]'); pg.wait_for_selector('#authForm:not([hidden])'); shot(pg, 'gost', 'registracija-srce', 500)
                pg.fill('#aShop', 'A'); pg.fill('#aEmail', 'ana@primjer'); pg.fill('#aPass', 'abcd'); pg.click('#authSubmit'); shot(pg, 'gost', 'registracija-greske', 500)
                pg.click('#authSwitch'); shot(pg, 'gost', 'prijava', 400)
            step('srce', srce)
            def snizeno():
                oglas(pg, IDS[2]); shot(pg, 'gost', 'feed-snizeno', 300)
            step('snizeno', snizeno)
            step('dugo', lambda: (oglas(pg, DUGO), shot(pg, 'gost', 'feed-dugo', 300)))
            step('svijetli', lambda: (oglas(pg, SVIJETLI), shot(pg, 'gost', 'feed-svijetli', 300)))
            step('sareno', lambda: (oglas(pg, SARENO), shot(pg, 'gost', 'feed-sareno', 300)))
            def profil_dugo():
                pg.goto(B + '/?b=' + S['handle_dugo']); pg.wait_for_selector('#vName'); shot(pg, 'gost', 'profil-butika-dugo', 1500)
            step('profil-dugo', profil_dugo)
            pg.goto(B + '/?b=moda.bojana'); shot(pg, 'gost', 'profil-butika', 1600)
            step('radno', lambda: (pg.click('#vStatus'), shot(pg, 'gost', 'profil-butika-radno', 300)))
            pg.goto(B + '/?b=nema.ga'); shot(pg, 'gost', 'butik-ne-postoji', 1000)
            pg.goto(B + '/'); pg.evaluate("document.getElementById('updateGate').hidden=false"); shot(pg, 'gost', 'nadogradnja', 300)
            c.close()
            # učitavanje i greška feeda
            c, pg = ctx('gost')
            def ucitavanje():
                pg.route('**/api/feed*', lambda r: None)  # zahtjev visi
                pg.goto(B + '/'); pg.wait_for_selector('.card.loading'); shot(pg, 'gost', 'feed-ucitavanje', 400)
            step('ucitavanje', ucitavanje)
            c.close()
            c, pg = ctx('gost')
            def greska():
                pg.route('**/api/feed*', lambda r: r.abort())
                pg.goto(B + '/'); pg.wait_for_selector('.empty-box'); shot(pg, 'gost', 'feed-greska', 600)
            step('greska', greska)
            c.close()
            # zatvoren butik (satnica 07:30, prije otvaranja)
            c, pg = ctx('gost', sat=jutro)
            step('zatvoreno', lambda: (oglas(pg, IDS[0]), shot(pg, 'gost', 'feed-zatvoreno', 300)))
            c.close()
            # D-04: prvi ulaz, „Praćeni” prije nego što uputa nestane: uputa se ne smije crtati preko praznog stanja
            c, pg = ctx('gost', uputa=False)
            def praceni_gost():
                pg.goto(B + '/'); pg.wait_for_selector('.card .cta'); pg.wait_for_timeout(600)
                pg.click('.ftab[data-k=praceni]'); shot(pg, 'gost', 'praceni-gost', 900)
                assert pg.locator('#uputa').is_hidden(), 'uputa preko praznog stanja'
            step('praceni-gost', praceni_gost)
            c.close()

            # ---------------- kupac
            c, pg = ctx('kupac')
            home(pg); shot(pg, 'kupac', 'feed-zatebe', 300); shot(pg, 'kupac', 'feed-kupac', 100); shot(pg, 'kupac', 'feed-sjaj', 100)
            def kontakt():
                pg.click('.card .cta'); shot(pg, 'kupac', 'kontakt', 500); shot(pg, 'kupac', 'kontakt-sjaj', 100)
            step('kontakt', kontakt)
            def vise():
                home(pg); pg.click('.card .act[data-act=more]'); shot(pg, 'kupac', 'vise', 400); shot(pg, 'kupac', 'vise-kupac', 100)
                pg.click('#buyerMoreSheet [data-act=report]'); shot(pg, 'kupac', 'prijavi', 400)
                pg.select_option('#reportReason', index=1); shot(pg, 'kupac', 'prijavi-oglas', 300)
                pg.click('#reportForm button[type=submit]'); shot(pg, 'kupac', 'toast', 500)
            step('vise', vise)
            home(pg); pg.click('.ftab[data-k=praceni]'); shot(pg, 'kupac', 'feed-praceni', 1000)
            pg.click('[data-go=profile]'); shot(pg, 'kupac', 'profil-kupca', 1200)
            step('pratim', lambda: (pg.click('#pSwitch'), shot(pg, 'kupac', 'profil-kupca-pratim', 900)))
            pg.click('[data-go=inbox]'); shot(pg, 'kupac', 'poruke-spisak', 900)
            def razg():
                pg.goto(B + '/?poruke=1'); pg.wait_for_selector('#chatLog .pcard'); shot(pg, 'kupac', 'razgovor', 900)
                pg.click('#chatMore'); shot(pg, 'kupac', 'razgovor-vise', 400)
            step('razgovor', razg)
            def razg_dugo():
                r = c.request.post(B + '/api/conversations', data={'shop': S['handle_dugo'], 'listingId': DUGO}); cid = r.json()['razgovor']
                pg.goto(B + '/?poruke=%s' % cid); pg.wait_for_selector('#chatLog .msg'); shot(pg, 'kupac', 'razgovor-dugo', 900)
                pg.click('[data-go=inbox]'); shot(pg, 'kupac', 'poruke-spisak-dugo', 900)
            step('razgovor-dugo', razg_dugo)
            c.close()
            # prazan prvi razgovor s porukom o radnom vremenu (torbica, prije 09:00)
            c, pg = ctx('kupac', sat=jutro)
            def prvi():
                r = c.request.post(B + '/api/conversations', data={'shop': 'torbica.bl', 'listingId': SARENO}); cid = r.json()['razgovor']
                pg.goto(B + '/?poruke=%s' % cid); pg.wait_for_selector('#chatLog .pcard'); shot(pg, 'kupac', 'razgovor-prvi', 900)
                assert pg.locator('#chatLog .pstatus').count() == 1, 'nema pstatus'
            step('razgovor-prvi', prvi)
            c.close()
            # prazan spisak poruka (novi kupac)
            c = br.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='bs-BA', timezone_id=tz)
            c.add_init_script("try{localStorage.setItem('komodo.uputa','1')}catch(e){}")
            def prazno_poruke():
                clr(); em = 'nova%d@proba.ba' % w
                r = c.request.post(B + '/api/auth/register', data={'name': 'Nova Kupac', 'email': em, 'password': PW}); assert r.ok or r.status == 409, r.text()
                if r.status == 409: c.request.post(B + '/api/auth/login', data={'email': em, 'password': PW})
                pg = c.new_page(); pg.goto(B + '/'); pg.wait_for_selector('.card'); pg.wait_for_timeout(700)
                pg.click('[data-go=inbox]'); shot(pg, 'kupac', 'poruke-prazno', 900)
            step('poruke-prazno', prazno_poruke)
            c.close()

            # ---------------- butik
            c, pg = ctx('b0')
            home(pg, '.card'); shot(pg, 'b0', 'feed-svoj', 300)
            def vlastiti():
                oglas(pg, IDS[1]); shot(pg, 'b0', 'feed-vlastiti', 300)
                pg.click('.card .act[data-act=more]'); shot(pg, 'b0', 'vise-vlasnik', 400)
                pg.click('[data-more=del]'); shot(pg, 'b0', 'confirm', 400)
                pg.click('#confirmNo'); pg.wait_for_timeout(200)
            step('vlastiti', vlastiti)
            def profil():
                home(pg, '.card'); pg.click('[data-go=profile]'); shot(pg, 'b0', 'profil-vlastiti', 1400)
                pg.click('#pEdit'); shot(pg, 'b0', 'uredi-profil', 500)
                pg.fill('#hFrom_rd', '20:00'); pg.fill('#hTo_rd', '09:00'); pg.click('#shopSave'); shot(pg, 'b0', 'uredi-profil-greska', 400)
                pg.click('#profClose'); pg.wait_for_timeout(300)
                pg.evaluate("document.querySelector('#profile').scrollTop=99999"); shot(pg, 'b0', 'profil-nalog', 400)
                pg.evaluate("document.querySelector('#profile').scrollTop=0"); pg.click('#pStatsOpen'); shot(pg, 'b0', 'statistika', 1200)
            step('profil', profil)
            def poruke():
                home(pg, '.card'); pg.click('[data-go=inbox]'); shot(pg, 'b0', 'poruke-spisak', 900); shot(pg, 'b0', 'poruke-butik', 100)
                pg.click('#inboxList button'); pg.wait_for_selector('#chat:not([hidden]) .msg'); shot(pg, 'b0', 'razgovor', 900)
            step('poruke', poruke)
            def objava():
                home(pg, '.card'); pg.click('#tabPost'); shot(pg, 'b0', 'objava-prazna', 500)
                pg.click('#postSubmit'); shot(pg, 'b0', 'objava-greske', 400)
                pg.set_input_files('#fVideo', VIDEO); pg.fill('#fTitle', 'Lanena haljina, bež'); pg.fill('#fPrice', '65')
                pg.click('#fSizes [data-size=S]'); pg.click('#fSizes [data-size=M]'); shot(pg, 'b0', 'objava-popunjena', 900)
                pg.fill('#fPrice', '65x'); pg.click('#postSubmit'); shot(pg, 'b0', 'objava-greska-cijena', 400)
                pg.fill('#fPrice', '65'); pg.click('#postSubmit'); shot(pg, 'b0', 'objava-u-izlogu', 1500)
                assert pg.evaluate("document.getElementById('doneAgain').getBoundingClientRect().right") <= w, 'doneAgain van ekrana'
            step('objava', objava)
            def izmjena():
                oglas(pg, IDS[3]); pg.click('.card .act[data-act=more]'); pg.wait_for_timeout(300)
                pg.click('[data-more=edit]'); pg.fill('#ePrice', '39,90'); shot(pg, 'b0', 'izmjena-snizenje', 500)
            step('izmjena', izmjena)
            c.close()
            # ---------------- admin
            c, pg = ctx('admin')
            def adm():
                home(pg, '.card'); pg.click('[data-go=profile]'); pg.click('#adminOpen'); shot(pg, 'admin', 'admin', 1500)
                pg.screenshot(path=OUT + '%d-admin-admin-pun.png' % w, full_page=True)
            step('admin', adm)
            c.close()
            br.close()

if __name__ == '__main__' and '--seed' not in sys.argv:
    sel = [a for a in sys.argv[1:] if a.isdigit()]
    snimi(int(sel[0]) if sel else None)
