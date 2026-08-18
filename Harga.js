function getPAXG() {
  var url = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=PAXG&convert=IDR";
  var options = {
    headers: {"X-CMC_PRO_API_KEY": "9f9598085cd7418c80737ece2cb7bfe5"}
  };
  var response = UrlFetchApp.fetch(url, options);
  var data = JSON.parse(response.getContentText());
  return data.data.PAXG.quote.IDR.price;
}
function getXAUT() {
  var url = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=XAUT&convert=IDR";
  var options = {
    headers: {"X-CMC_PRO_API_KEY": "9f9598085cd7418c80737ece2cb7bfe5"}
  };
  var response = UrlFetchApp.fetch(url, options);
  var data = JSON.parse(response.getContentText());
  return data.data.XAUt.quote.IDR.price;
}

