// Lažni SMTP server za testove: prima poruke i čuva ih u memoriji (bez TLS-a i bez provjere).
// API mu se spaja preko SMTP_URL=smtp://127.0.0.1:<port>, pa se testira i put „email je podešen”.
import net from 'node:net';

export async function lazniSmtp() {
  const poruke = [];
  const cekaju = [];
  const server = net.createServer((sock) => {
    let buf = '';
    let data = false;
    let msg = { to: [], text: '' };
    const send = (line) => sock.write(`${line}\r\n`);
    send('220 lazni-smtp');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        if (data) {
          if (line === '.') {
            data = false;
            const gotova = { to: msg.to, raw: msg.text, text: dekodiraj(msg.text) };
            poruke.push(gotova);
            for (const c of cekaju.splice(0)) c();
            msg = { to: [], text: '' };
            send('250 OK');
          } else {
            msg.text += `${line.startsWith('..') ? line.slice(1) : line}\n`;
          }
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') send('250 lazni-smtp');
        else if (cmd === 'MAIL') send('250 OK');
        else if (cmd === 'RCPT') { msg.to.push(/<([^>]*)>/.exec(line)?.[1] || ''); send('250 OK'); }
        else if (cmd === 'DATA') { data = true; send('354 Kraj s .'); }
        else if (cmd === 'QUIT') { send('221 Zdravo'); sock.end(); }
        else send('250 OK');
      }
    });
    sock.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    url: `smtp://127.0.0.1:${port}`,
    poruke,
    // Čeka poruku za datu adresu čiji tekst odgovara izrazu; vraća prvo poklapanje grupe 1 (ili cijeli tekst).
    async cekaj(to, re, ms = 5000) {
      const end = Date.now() + ms;
      for (;;) {
        const hit = poruke.find((p) => p.to.includes(to) && re.test(p.text));
        if (hit) { const m = re.exec(hit.text); return m[1] ?? m[0]; }
        if (Date.now() > end) throw new Error(`Nema emaila za ${to} koji odgovara ${re}`);
        await new Promise((r) => { cekaju.push(r); setTimeout(r, 100); });
      }
    },
    close: () => new Promise((r) => server.close(r)),
  };
}

// Tijelo poruke: nodemailer šalje quoted-printable ili base64; za testove je dovoljno oboje razmotati.
function dekodiraj(raw) {
  const [head, ...rest] = raw.split('\n\n');
  const body = rest.join('\n\n');
  if (/content-transfer-encoding:\s*base64/i.test(head)) {
    return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  }
  if (/content-transfer-encoding:\s*quoted-printable/i.test(head)) {
    const bytes = body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(bytes, 'latin1').toString('utf8');
  }
  return body;
}
