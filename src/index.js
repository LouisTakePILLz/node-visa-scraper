import Crawler from 'crawler';
import url from 'url';

const BASE_ADDRESS = 'https://en.wikipedia.org/';
const COUNTRY_PATTERN = /.*?Visa_requirements_for_(.*?)_citizens(?:_of_(.*)|.*?)/i;
const VISA_REQUIRED_PATTERN = /.*?visa\s+required.*?/i;
const VISA_NOT_REQUIRED_PATTERN = /.*?visa\s+not\s+required.*?/i;
const COUNTRY_COLUMN_PATTERN = /.*?(?:(?:territor|countr)(?:y|ies)|areas?|europe|africa|america|asia).*?/i;

const visaRequirements = {};

function isVisaRequired(text, notes) {
  if (!text)
    return;

  if (VISA_REQUIRED_PATTERN.test(text))
    return true;

  if (VISA_NOT_REQUIRED_PATTERN.test(text))
    return false;

  return text;
}

function getText(el) {
  return el.clone()
           .children('sub, sup')
           .remove()
           .end()
           .text();
}

const extractRefs = (el, $) =>
  [...el.find('sup, sub')]
    .reduce((c, el) => {
      return c.concat(
        [...$(el).find('a')]
          .map(el => {
            const a = $(el);
            const linkRef = a.attr('href');
            if (linkRef.startsWith('#'))
              return $(linkRef).find('a.external').first().attr('href');

            return linkRef;
          }).filter(x => x != null)
      );
    }, []);

const scrapeVisaRequirements = (key, reqs) => (error, result, $) => {
  const tables = $('table.wikitable');

  tables.each((index, el) => {
    const t = $(el);

    const rows = t.find('tr').toArray();
    const header = $(rows.shift());
    if (!COUNTRY_COLUMN_PATTERN.test(header.find('th, td').first().text())) return;

    $(rows).each((index, el) => {
      const tr = $(el);
      if (!tr.children('td').length) return;

      const children = tr.children('th, td').toArray().map(el => $(el));
      const country = getText(children.shift()).trim();
      const reqEl = children[0];
      if (!reqEl) return;

      const notesEl = children[1] || children[0];
      const notes = notesEl ? getText(notesEl).trim() : '';
      const refs = notesEl
        ? [...extractRefs(notesEl, $), ...extractRefs(reqEl, $)]
        : [...extractRefs(reqEl, $)];
      const visaReq = isVisaRequired(getText(reqEl), notes);

      reqs[country] = {visaRequired: visaReq, notes, refs};
    });
  });

  console.log(`${key}: Scraped ${Object.keys(reqs).length} entries from ${tables.length} tables`);
};

const tasks = [];

new Crawler({
  callback(error, result, $) {
    $('a').each((index, a) => {
      const refUrl = $(a).attr('href');
      if (!refUrl) return;

      const result = refUrl.match(COUNTRY_PATTERN);
      if (!result) return;

      const country = unescape(result[1].trim());
      const region = result[2] && unescape(result[2].trim());
      const identifier = region ? `${country}_${region}` : country;

      //if (country !== 'Saint_Vincent_and_the_Grenadines') return;
      //if (country !== 'British_Overseas_Territories') return;
      //if (country !== 'Chinese') return;

      if (visaRequirements[identifier]) return;

      const reqs = visaRequirements[identifier] = {};
      tasks.push({
        uri: refUrl.startsWith('http') ? refUrl : url.resolve(BASE_ADDRESS, refUrl),
        callback: scrapeVisaRequirements(identifier, reqs)
      });
    });
  },
  onDrain() {
    new Crawler({
      maxConnections: 50,
      onDrain() {
        const fs = require('fs');

        fs.writeFile('./visa.json', JSON.stringify(visaRequirements, null, 2), (err) => {
          if (err)
            console.log(err);
        });
      }
    }).queue([...tasks]);
  }
}).queue(url.resolve(BASE_ADDRESS, '/wiki/Category:Visa_requirements_by_nationality'));
