// Dados iniciais extraídos de "estudo_completo_BTS - 03_08_2026.xlsx"
const X = null; // "XXXX" na planilha = não usado

const settings = [
  ['dvb_available', 'Banda disponível no mux DVB (Mbps)', 32.297],
  ['isdb_layer_b_total', 'Capacidade da layer B ISDB-T (Mbps)', 12.483],
  ['isdb_layer_b_used_reported', 'Layer B usada, valor informado na planilha (Mbps)', 11.8606],
];

// [service_id, nome, codec, sistema]
const services = [
  [1, 'RÁDIO AM', 'MPEG 1', 'DVB'],
  [2, 'RÁDIO FM', 'MPEG 1', 'DVB'],
  [3, 'SPNET HD', 'MPEG 4', 'DVB'],
  [4, 'CULTURA SD', 'MPEG 4', 'DVB'],
  [5, 'RTB SD', 'MPEG 2', 'DVB'],
  [10, 'RTB HD', 'MPEG 2', 'DVB'],
  [11, 'CULT AAC', 'MPEG 4', 'DVB'],
  [12, 'FEED', 'MPEG 4', 'DVB'],
  [59232, 'CULTURA HD', 'MPEG 4', 'ISDB-T'],
  [59233, 'UNIVESP', 'MPEG 4', 'ISDB-T'],
  [59234, 'REDE ALESP', 'MPEG 4', 'ISDB-T'],
  [59234, 'CANAL 2.4', 'MPEG 4', 'ISDB-T'],
  [59256, 'CULTURA 1S', 'MPEG 4', 'ISDB-T'],
  [null, 'COMUNIC', null, 'DVB'],
  [null, 'EDUCAÇÃO', null, 'ISDB-T'],
];

// nome: [v, a1, a2, a3, a4, pcr, pmt, dem, ait, cc, ect, data]
const pids = {
  'RÁDIO AM':   [X, 120, X, X, X, 110, 100, X, X, X, X, X],
  'RÁDIO FM':   [X, 121, X, X, X, 210, 200, X, X, X, X, X],
  'SPNET HD':   [310, 320, 321, 322, X, 305, 300, X, X, X, X, X],
  'CULTURA SD': [410, 420, 421, X, X, 410, 400, X, X, X, X, X],
  'RTB SD':     [510, 520, 521, X, X, 510, 500, X, X, X, X, X],
  'RTB HD':     [1010, 1020, 1021, X, X, 1010, 1000, X, X, X, X, X],
  'CULT AAC':   [X, 1120, X, X, X, 1105, 1100, X, X, X, X, X],
  'FEED':       [1310, 1320, 1321, 1322, X, 1305, 1300, X, X, X, X, X],
  'CULTURA HD': [610, 620, 621, 622, 623, 605, 600, 670, 660, 630, 640, 650],
  'UNIVESP':    [710, 720, 721, 722, X, 705, 700, 770, 760, 730, 740, 750],
  'REDE ALESP': [810, 820, 821, 822, X, 805, 800, 870, 860, 830, 840, 850],
  'CANAL 2.4':  [1210, 1220, X, X, X, 1205, 1200, 1270, 1260, 1230, 1240, 1250],
  'CULTURA 1S': [910, 920, X, X, X, 905, 8136, 970, 960, 930, 940, 950],
};

// [nome, config, mbps, label original, observação]
const bitrates = [
  ['RÁDIO AM', 'pids_total', 0.203], ['RÁDIO FM', 'pids_total', 0.203], ['SPNET HD', 'pids_total', 5.01],
  ['CULTURA SD', 'pids_total', 1.3], ['RTB SD', 'pids_total', 1.2], ['RTB HD', 'pids_total', 4.01],
  ['CULT AAC', 'pids_total', 0.204],
  ['FEED', 'pids_total', 5.01, null, 'Anotado 4,0. Este valor deverá ser analisado com muito critério.'],
  ['CULTURA HD', 'pids_total', 5.601], ['UNIVESP', 'pids_total', 1.96], ['REDE ALESP', 'pids_total', 1.96],
  ['CANAL 2.4', 'pids_total', 1.96, 'CANAL NOVO ( 2.4)'], ['CULTURA 1S', 'pids_total', 0.3],

  ['RÁDIO AM', 'titular', 0.203], ['RÁDIO FM', 'titular', 0.203], ['SPNET HD', 'titular', 5],
  ['CULTURA SD', 'titular', 1.2], ['RTB SD', 'titular', 1.3], ['RTB HD', 'titular', 4],
  ['CULT AAC', 'titular', 0.204], ['FEED', 'titular', 5], ['CULTURA HD', 'titular', 5.6],
  ['UNIVESP', 'titular', 1.96], ['REDE ALESP', 'titular', 1.96], ['CULTURA 1S', 'titular', 0.3],
  ['CANAL 2.4', 'titular', 1.65, 'CANAL 2.4 ( NOVO )'],

  ['RÁDIO AM', 'reserva', 0.196], ['RÁDIO FM', 'reserva', 0.196], ['SPNET HD', 'reserva', 5],
  ['CULTURA SD', 'reserva', 1.3], ['RTB SD', 'reserva', 1.3], ['RTB HD', 'reserva', 4],
  ['CULT AAC', 'reserva', 0.201], ['FEED', 'reserva', 5], ['CULTURA HD', 'reserva', 5.4],
  ['UNIVESP', 'reserva', 1.96], ['REDE ALESP', 'reserva', 1.96], ['CULTURA 1S', 'reserva', 0.3],
  ['CANAL 2.4', 'reserva', 1.65, 'CANAL 2.4 ( NOVO )'],

  ['RÁDIO AM', 'antigo', 0.203, 'CULT BRASIL'], ['RÁDIO FM', 'antigo', 0.203], ['SPNET HD', 'antigo', 5.9],
  ['CULTURA SD', 'antigo', 2.3], ['RTB SD', 'antigo', 2.2], ['RTB HD', 'antigo', 4],
  ['CULT AAC', 'antigo', 0.3], ['CULTURA HD', 'antigo', 6.4], ['UNIVESP', 'antigo', 2.1],
  ['REDE ALESP', 'antigo', 2.1], ['CULTURA 1S', 'antigo', 0.3],
];

// Ordem da aba TAXAS
const taxaServices = ['RÁDIO AM', 'RÁDIO FM', 'SPNET HD', 'CULTURA SD', 'RTB SD', 'RTB HD', 'COMUNIC', 'CULTURA HD', 'UNIVESP', 'EDUCAÇÃO', 'CULTURA 1S'];
const taxas = {
  enc: { a1: [192, 192, 96, 100, 96, 96, 64, 96, 85, 85, 50], a2: [X, X, 96, 100, 0, 0, X, 96, 0, 0, X], a3: [X, X, 96, X, X, X, X, 96, 0, 0, X], a4: [X, X, X, X, X, X, X, 459, X, X, X], v: [X, X, 5, 2.06, 2.07, 3.8, X, 6.8, 1.48, 1.41, 0.251], cc: [X, X, X, X, X, X, X, 2.8, 2.8, 2.7, 5.5] },
  mux: { a1: [196, 196, 141, 100, 100, 112, 66, 141, 85, 85, 52], a2: [X, X, 141, 100, 0, 0, X, 141, 0, 0, X], a3: [X, X, 141, X, X, X, X, 141, 0, 0, X], a4: [X, X, X, X, X, X, X, 459, X, X, X], v: [X, X, 5.2, 2.1, 2.1, 3.8, X, 5.2, 1.5, 1.5, 0.27], cc: [X, X, X, X, X, X, X, 2.8, 2.8, 2.7, 5.5] },
};

const isdbLayers = [
  ['B', 'TV CULTURA HD', 5.2], ['B', 'UNIVESP', 2], ['B', 'REDE ALESP', 2.1], ['B', 'Canal 2.5', 0.8],
  ['B', 'CANAL 2.4', 1.36], ['A', 'TV CULTURA 1SEG', 0.3746], ['Tabelas', 'NIT, PAT, TOT…', 0.026],
];

const isdbPids = [
  ['TABELAS', 0, 'PAT', 0.02], ['TABELAS', 1, 'CAT', 0.003], ['TABELAS', 16, 'NIT', 0], ['TABELAS', 17, 'SDT', 0.0015], ['TABELAS', 20, 'TOT', 0], ['TABELAS', 36, 'UNKNOWN', 0.0015],
  ['CULTURA HD', 600, 'PMT', 0.019], ['CULTURA HD', 605, 'PCR', 0.06], ['CULTURA HD', 610, 'VIDEO', 5], ['CULTURA HD', 620, 'AUDIO', 0.101], ['CULTURA HD', 621, 'AUDIO', 0.064], ['CULTURA HD', 622, 'AUDIO', 0.064], ['CULTURA HD', 623, 'AUDIO', 0], ['CULTURA HD', 630, 'CC', 0.0043], ['CULTURA HD', 660, 'PRIVATE SECTIONS', 0], ['CULTURA HD', 670, '13818-6 TYPE B', 0],
  ['UNIVESP', 700, 'PMT', 0.02], ['UNIVESP', 705, 'PCR', 0.041], ['UNIVESP', 710, 'VIDEO', 1.96], ['UNIVESP', 720, 'AUDIO', 0.068], ['UNIVESP', 721, 'AUDIO', 0], ['UNIVESP', 730, 'CC', 0.0043], ['UNIVESP', 760, 'PRIVATE SECTIONS', 0], ['UNIVESP', 770, '13818-6 TYPE B', 0],
  ['REDE ALESP', 800, 'PMT', 0.02], ['REDE ALESP', 805, 'PCR', 0.042], ['REDE ALESP', 810, 'VIDEO', 1.96], ['REDE ALESP', 820, 'AUDIO', 0.068], ['REDE ALESP', 821, 'AUDIO', 0], ['REDE ALESP', 830, 'CC', 0.0043], ['REDE ALESP', 860, 'PRIVATE SECTIONS', 0], ['REDE ALESP', 870, '13818-6 TYPE B', 0],
  ['1-SEG', 905, 'PCR', 0.043], ['1-SEG', 910, 'VIDEO', 0.27], ['1-SEG', 920, 'AUDIO', 0.05], ['1-SEG', 930, 'CC', 0.0014], ['1-SEG', 960, 'UNKNOWN', 0], ['1-SEG', 970, 'UNKNOWN', 0], ['1-SEG', 8136, 'PMT', 0.0102],
];

async function seed(client) {
  for (const [key, label, value] of settings)
    await client.query('INSERT INTO settings (key,label,value) VALUES ($1,$2,$3)', [key, label, value]);

  const ids = {};
  for (const [i, [sid, name, codec, system]] of services.entries()) {
    const r = await client.query('INSERT INTO services (service_id,name,codec,system,sort) VALUES ($1,$2,$3,$4,$5) RETURNING id', [sid, name, codec, system, i]);
    ids[name] = r.rows[0].id;
  }
  for (const [name, p] of Object.entries(pids))
    await client.query('INSERT INTO service_pids (service_id,v,a1,a2,a3,a4,pcr,pmt,dem,ait,cc,ect,data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [ids[name], ...p]);
  for (const [name, config, mbps, label = null, note = null] of bitrates)
    await client.query('INSERT INTO bitrates (service_id,config,label,mbps,note) VALUES ($1,$2,$3,$4,$5)', [ids[name], config, label, mbps, note]);
  for (const source of ['enc', 'mux']) {
    const t = taxas[source];
    for (const [i, name] of taxaServices.entries())
      await client.query('INSERT INTO encoder_rates (service_id,source,a1,a2,a3,a4,v,cc) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [ids[name], source, t.a1[i], t.a2[i], t.a3[i], t.a4[i], t.v[i], t.cc[i]]);
  }
  for (const [i, [layer, name, mbps]] of isdbLayers.entries())
    await client.query('INSERT INTO isdb_layers (layer,name,mbps,sort) VALUES ($1,$2,$3,$4)', [layer, name, mbps, i]);
  for (const [i, [grp, pid, ident, mbps]] of isdbPids.entries())
    await client.query('INSERT INTO isdb_pids (grp,pid,ident,mbps,sort) VALUES ($1,$2,$3,$4,$5)', [grp, pid, ident, mbps, i]);
}

module.exports = { seed };
