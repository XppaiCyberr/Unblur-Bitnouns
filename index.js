import fs from 'fs';
import path from 'path';
import 'dotenv/config'; // loads .env into process.env

// Support loading custom path since dotenv natively loads .env not .env.local
// Let's use config constructor to load .env.local specifically
import dotenv from 'dotenv';
import { unblurImage } from './unblur.js';
dotenv.config({ path: '.env.local' });

const apiKey = process.env.OPENSEA_API_KEY;
if (!apiKey) {
  console.error('Missing OPENSEA_API_KEY (set in .env.local or GitHub Secrets)');
  process.exit(1);
}

const COLLECTION_SLUG = 'bitnouns';
const OUTPUT_DIR = path.join(process.cwd(), 'images');

async function downloadImage(url, filename) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.statusText}`);

    const buffer = Buffer.from(await res.arrayBuffer());

    let toWrite = buffer;
    try {
      toWrite = await unblurImage(buffer);
    } catch (err) {
      console.warn(`Unblur failed for ${url}, saving original:`, err.message);
    }

    await fs.promises.writeFile(filename, toWrite);
    console.log(`Downloaded: ${filename}`);
  } catch (error) {
    console.error(`Error downloading ${url}:`, error.message);
  }
}

async function fetchNFTs() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR);
  }

  let next = '';
  let count = 0;

  console.log(`Fetching NFTs for collection: ${COLLECTION_SLUG}...`);

  do {
    const url = new URL(`https://api.opensea.io/api/v2/collection/${COLLECTION_SLUG}/nfts`);
    url.searchParams.append('limit', '50');
    if (next) {
      url.searchParams.append('next', next);
    }

    try {
      const response = await fetch(url.toString(), {
        headers: {
          'x-api-key': apiKey,
          'accept': 'application/json'
        }
      });

      if (!response.ok) {
        console.error(`Failed to fetch from OpenSea: ${response.status} ${response.statusText}`);
        const text = await response.text().catch(() => '');
        console.error(text);
        break;
      }

      const data = await response.json();
      const nfts = data.nfts || [];

      for (const nft of nfts) {
        const imageUrl = nft.image_url;
        if (!imageUrl) continue;

        // Processed output is always PNG
        const filename = path.join(OUTPUT_DIR, `${nft.identifier || count}.png`);

        await downloadImage(imageUrl, filename);
        count++;
      }

      next = data.next;

      // Be gentle to rate limits
      await new Promise(r => setTimeout(r, 1000));

    } catch (error) {
      console.error('Fetch error:', error.message);
      break;
    }
  } while (next);

  console.log(`Finished processing. Downloaded ${count} images.`);
}

fetchNFTs();
