// Fyller i stödmedlemsdiplomet (worker/diplom/mall.pdf) med namn, medlemsnummer
// och medlemsår.
//
// mall.pdf är BK_LOET_Diplom.pdf med de tre platshållarna ("Förnamn Efternamn",
// "001", "2026") borttagna ur sidans innehåll — allt annat är orört. Texten ritas
// här på samma plats, i samma storlek och färg. Originalet använder Georgia Bold;
// vi bäddar in Gelasio Bold (fri licens, OFL.txt) som har exakt samma
// teckenbredder, så att centreringen blir densamma.
//
// worker/vendor/pdf-lib.js är pdf-lib 1.17.1 + @pdf-lib/fontkit 1.1.1 hopbuntade
// med esbuild (--format=esm --platform=neutral), så att Workern inte behöver npm.

import { PDFDocument, rgb, fontkit } from './vendor/pdf-lib.js';
import mall from './diplom/mall.pdf';
import typsnitt from './diplom/gelasio-bold.ttf';

const BLA = rgb(0.122, 0.22, 0.392);

// Koordinater i PDF-punkter (origo nere till vänster), uppmätta i originalet.
const NAMN = { mitt: 297.7, baslinje: 391.85, storlek: 36, maxBredd: 420 };
const NUMMER = { mitt: 200.46, baslinje: 166.46, storlek: 32.064 };
const AR = { mitt: 392.67, baslinje: 166.27, storlek: 32.04 };

export async function skapaDiplom({ fornamn, efternamn, medlemsnummer, ar }) {
  const doc = await PDFDocument.load(mall);
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(typsnitt, { subset: true });
  const sida = doc.getPage(0);

  const centrerad = (text, { mitt, baslinje, storlek, maxBredd }) => {
    let size = storlek;
    // Långa namn krymps så att de ryms på sidan.
    if (maxBredd) {
      const bredd = font.widthOfTextAtSize(text, size);
      if (bredd > maxBredd) size = size * maxBredd / bredd;
    }
    const bredd = font.widthOfTextAtSize(text, size);
    sida.drawText(text, { x: mitt - bredd / 2, y: baslinje, size, font, color: BLA });
  };

  const namn = `${fornamn} ${efternamn}`.replace(/\s+/g, ' ').trim();
  centrerad(namn, NAMN);
  centrerad(String(medlemsnummer).padStart(3, '0'), NUMMER);
  centrerad(String(ar), AR);

  doc.setTitle(`Diplom – ${namn}`);
  return doc.save();
}
