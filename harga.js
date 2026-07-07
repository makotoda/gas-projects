/**
 * harga.gs — Harga emas ter-tokenisasi (PAXG & XAUT) dalam IDR via CoinMarketCap.
 *
 * API key TIDAK di-hardcode di sini. Set sekali di:
 * Apps Script editor > Project Settings (ikon gerigi) > Script Properties
 *   Property: CMC_API_KEY
 *   Value:    <API key CoinMarketCap Anda>
 */

function getCmcApiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('CMC_API_KEY');
  if (!key) {
    throw new Error('CMC_API_KEY belum diset. Buka Project Settings > Script Properties.');
  }
  return key;
}

function getHargaIdr_(symbol) {
  const url = 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest'
    + '?symbol=' + encodeURIComponent(symbol) + '&convert=IDR';
  const response = UrlFetchApp.fetch(url, {
    headers: { 'X-CMC_PRO_API_KEY': getCmcApiKey_() }
  });
  const data = JSON.parse(response.getContentText());
  return data.data[symbol].quote.IDR.price;
}

function getPAXG() {
  return getHargaIdr_('PAXG');
}

function getXAUT() {
  return getHargaIdr_('XAUT');
}
