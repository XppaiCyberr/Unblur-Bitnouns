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

async function getMaxProcessedId(outputDir) {
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
      return 0;
    }

    const files = await fs.promises.readdir(outputDir);
    let maxId = 0;

    for (const file of files) {
      const match = /^(\d+)\.png$/.exec(file);
      if (!match) continue;

      const id = Number.parseInt(match[1], 10);
      if (Number.isFinite(id) && id > maxId) {
        maxId = id;
      }
    }

    return maxId;
  } catch (error) {
    console.warn('Failed to scan images directory, defaulting maxProcessedId to 0:', error.message);
    return 0;
  }
}

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
  const maxProcessedId = await getMaxProcessedId(OUTPUT_DIR);
  let next = '';
  let count = 0;
  let downloadedCount = 0;
  let newMaxId = maxProcessedId;

  console.log(`Detected max processed ID: ${maxProcessedId}`);
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

      let anyNewIdThisPage = false;
      let allNumericThisPage = true;

      for (const nft of nfts) {
        const imageUrl = nft.image_url;
        if (!imageUrl) continue;
        const identifier = nft.identifier;

        const tokenId = Number.parseInt(identifier, 10);
        if (!Number.isFinite(tokenId)) {
          // Fallback to legacy behavior when identifier is not a numeric token ID
          const fallbackFilename = path.join(OUTPUT_DIR, `${identifier || count}.png`);

          if (fs.existsSync(fallbackFilename)) {
            console.log(`Skipped (exists, fallback): ${fallbackFilename}`);
            count++;
            continue;
          }

          await downloadImage(imageUrl, fallbackFilename);
          count++;
          downloadedCount++;
          continue;
        }

        if (tokenId <= maxProcessedId) {
          console.log(`Skipped (already processed by ID): ${tokenId}`);
          allNumericThisPage = allNumericThisPage && true;
          continue;
        }

        allNumericThisPage = allNumericThisPage && true;
        anyNewIdThisPage = true;

        // Processed output is always PNG
        const filename = path.join(OUTPUT_DIR, `${tokenId}.png`);

        if (fs.existsSync(filename)) {
          console.log(`Skipped (exists): ${filename}`);
          continue;
        }

        await downloadImage(imageUrl, filename);
        downloadedCount++;
        if (tokenId > newMaxId) {
          newMaxId = tokenId;
        }
      }

      next = data.next;

      if (nfts.length > 0 && allNumericThisPage && !anyNewIdThisPage) {
        console.log('No NFTs with ID > maxProcessedId found on this page; stopping pagination.');
        break;
      }

      // Be gentle to rate limits
      await new Promise(r => setTimeout(r, 1000));

    } catch (error) {
      console.error('Fetch error:', error.message);
      break;
    }
  } while (next);

  console.log(`Finished processing. Downloaded ${downloadedCount} new images. Max processed ID (approx): ${newMaxId}`);
}

fetchNFTs();
