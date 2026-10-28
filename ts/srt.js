// Recebe um stream SRT e repassa os pacotes do TS, sem alterar nada, para a análise.
// Usa o srt-live-transmit (pacote srt-tools) ou, se não houver, o ffmpeg compilado com SRT.
'use strict';
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { TsAnalyzer } = require('./analyzer');

let toolCache;
function which(cmd) {
  for (const dir of (process.env.PATH || '/usr/bin:/usr/local/bin').split(path.delimiter)) {
    const p = path.join(dir, cmd);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* não está aqui */ }
  }
  return null;
}
// Ferramenta disponível para receber SRT: { kind: 'slt'|'ffmpeg', path } ou null
function srtTool() {
  if (toolCache !== undefined) return toolCache;
  const slt = which('srt-live-transmit');
  if (slt) return (toolCache = { kind: 'slt', path: slt, label: 'srt-live-transmit' });
  const ff = which('ffmpeg');
  if (ff) {
    try {
      const out = execFileSync(ff, ['-hide_banner', '-protocols'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
      if (/^\s*srt\s*$/m.test(out)) return (toolCache = { kind: 'ffmpeg', path: ff, label: 'ffmpeg' });
    } catch { /* ffmpeg sem SRT */ }
  }
  return (toolCache = null);
}

const isHost = h => /^[A-Za-z0-9.-]{1,253}$/.test(h || '');

// Monta o endereço srt:// com as opções (latência em ms)
function srtUrl(tool, { host, port, mode, latency, passphrase, streamid }) {
  const q = new URLSearchParams();
  q.set('mode', mode);
  if (latency) q.set('latency', String(tool.kind === 'ffmpeg' ? latency * 1000 : latency)); // ffmpeg usa microssegundos
  if (passphrase) { q.set('passphrase', passphrase); q.set('pbkeylen', '16'); }
  if (streamid) q.set('streamid', streamid);
  if (tool.kind === 'ffmpeg') { q.set('pkt_size', '1316'); if (mode === 'caller') q.set('connect_timeout', '5000'); }
  const h = mode === 'listener' ? (host || '0.0.0.0') : host;
  return `srt://${h}:${port}?${q.toString()}`;
}

/**
 * captureSrt({ host, port, mode: 'caller'|'listener', latency, passphrase, streamid, seconds })
 *   caller    o sistema conecta no equipamento (host:porta do equipamento)
 *   listener  o sistema espera o equipamento conectar nesta porta
 */
function captureSrt({ host = '', port, mode = 'caller', latency = 200, passphrase = '', streamid = '', seconds = 10, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const tool = srtTool();
    if (!tool) return reject(friendly('Este servidor não tem como receber SRT. Instale o pacote srt-tools: sudo apt install srt-tools', 'sem_srt'));
    port = Number(port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return reject(friendly('Porta inválida (1 a 65535).'));
    if (mode === 'caller' && !isHost(host)) return reject(friendly('Informe o IP do equipamento SRT.'));
    if (host && !isHost(host)) return reject(friendly('Endereço inválido.'));
    seconds = Math.min(60, Math.max(2, Number(seconds) || 10));
    const an = new TsAnalyzer();
    const sock = dgram.createSocket('udp4');
    let child = null, done = false, timer = null, tick = null, first = null, errTail = '';
    const finish = err => {
      if (done) return; done = true;
      clearTimeout(timer); clearInterval(tick);
      try { sock.close(); } catch { /* fechado */ }
      if (child) { try { child.kill('SIGTERM'); } catch { /* já saiu */ } }
      if (err) return reject(err);
      if (!an.datagrams) {
        const why = errTail.trim().split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300);
        return reject(friendly(mode === 'caller'
          ? `Não recebi o stream SRT de ${host}:${port}. Confira o IP, a porta, se o equipamento está em modo listener, a senha e o stream ID.${why ? ' Detalhe: ' + why : ''}`
          : `Nenhum equipamento conectou na porta ${port} em ${seconds + 8} s. Confira se o equipamento está em modo caller apontando para este servidor e se o firewall libera a porta UDP ${port}.${why ? ' Detalhe: ' + why : ''}`, 'sem_pacotes'));
      }
      if (!an.packets) return reject(friendly('Chegaram dados pelo SRT, mas não são MPEG-TS.', 'nao_ts'));
      const r = an.result();
      r.transport = 'SRT'; r.srt = { mode, latency, encrypted: !!passphrase, tool: tool.label };
      resolve(r);
    };
    sock.on('error', e => finish(friendly(`Erro de rede: ${e.message}`)));
    // descarta o 1º segundo: ao conectar, o SRT entrega de uma vez o que estava no buffer e a taxa sairia alta
    let warm = null;
    sock.on('message', msg => {
      const now = Date.now();
      if (warm == null) warm = now;
      if (now - warm < 1500) return;
      if (first == null) first = now;
      an.pushStream(msg, now);
    });
    // porta local livre para a ferramenta entregar os pacotes
    sock.bind({ port: 0, address: '127.0.0.1' }, () => {
      try { sock.setRecvBufferSize(8 * 1024 * 1024); } catch { /* limite do sistema */ }
      const local = `udp://127.0.0.1:${sock.address().port}`;
      const url = srtUrl(tool, { host, port, mode, latency, passphrase, streamid });
      const args = tool.kind === 'slt'
        ? ['-q', url, local]
        : ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'data', '-raw_packet_size', '1316', '-i', url, '-map', '0', '-c', 'copy', '-f', 'data', `${local}?pkt_size=1316`];
      child = spawn(tool.path, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      child.stderr.on('data', d => { errTail = (errTail + d.toString()).slice(-2000); });
      child.on('error', e => finish(friendly(`Não consegui rodar o ${tool.label}: ${e.message}`)));
      child.on('exit', () => { if (!first) setTimeout(() => finish(), 200); });
      const startedAt = Date.now(), waitFirst = (seconds + 8) * 1000; // SRT leva um pouco para conectar
      tick = setInterval(() => {
        const t = first ? Date.now() - first : 0;
        if (onProgress) onProgress({ elapsed: t / 1000, datagrams: an.datagrams });
        if (first && t >= seconds * 1000) finish();
        else if (!first && Date.now() - startedAt >= waitFirst) finish();
      }, 100);
      timer = setTimeout(() => finish(), (seconds * 2 + 15) * 1000);
    });
  });
}

// Liga um repasse UDP -> SRT (listener) para o teste local. Devolve o processo.
function srtBridge(udpPort, srtPort) {
  const tool = srtTool();
  if (!tool) return null;
  const url = srtUrl(tool, { host: '127.0.0.1', port: srtPort, mode: 'listener', latency: 120 });
  const args = tool.kind === 'slt'
    ? ['-q', `udp://127.0.0.1:${udpPort}`, url]
    : ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'data', '-raw_packet_size', '1316', '-i', `udp://127.0.0.1:${udpPort}`, '-map', '0', '-c', 'copy', '-f', 'data', url];
  return spawn(tool.path, args, { stdio: 'ignore' });
}

function friendly(msg, code) { return Object.assign(new Error(msg), { friendly: true, code }); }

module.exports = { captureSrt, srtTool, srtBridge, isHost };
