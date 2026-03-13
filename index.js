import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';
import { unblurImage } from './unblur.js';

const rpcUrl = "https://eth.drpc.org";

const CONTRACT_ADDRESS = '0xd7cb208297f661867a43c08afe5980ee88dfc678';
const OUTPUT_DIR = path.join(process.cwd(), 'images');

async function getTokenState(outputDir) {
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
      return { maxId: 0, existingIds: new Set() };
    }

    const files = await fs.promises.readdir(outputDir);
    let maxId = 0;
    const existingIds = new Set();

    for (const file of files) {
      const match = /^(\d+)\.png$/.exec(file);
      if (!match) continue;

      const id = Number.parseInt(match[1], 10);
      if (Number.isFinite(id) && id > maxId) {
        maxId = id;
      }
      if (Number.isFinite(id)) {
        existingIds.add(id);
      }
    }

    return { maxId, existingIds };
  } catch (error) {
    console.warn('Failed to scan images directory, defaulting token state to empty:', error.message);
    return { maxId: 0, existingIds: new Set() };
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

function extractImageUrlFromTokenUri(tokenUri) {
  if (!tokenUri || typeof tokenUri !== 'string') return null;

  if (!tokenUri.startsWith('data:')) {
    return tokenUri;
  }

  const base64Index = tokenUri.indexOf('base64,');
  if (base64Index === -1) return null;

  const base64Payload = tokenUri.slice(base64Index + 'base64,'.length);
  try {
    const json = Buffer.from(base64Payload, 'base64').toString('utf8');
    const metadata = JSON.parse(json);
    if (metadata && typeof metadata.image === 'string') {
      return metadata.image;
    }
    return null;
  } catch (error) {
    console.error('Failed to decode tokenURI metadata:', error.message);
    return null;
  }
}

async function fetchNFTs() {
  const { maxId: maxProcessedId, existingIds } = await getTokenState(OUTPUT_DIR);
  let downloadedCount = 0;
  let newMaxId = maxProcessedId;

  console.log(`Detected max processed ID: ${maxProcessedId}`);
  console.log(`Fetching NFTs directly from contract: ${CONTRACT_ADDRESS}...`);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const abi = ['function tokenURI(uint256 tokenId) view returns (string)'];
  const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);

  const MAX_CONSECUTIVE_FAILURES = 10;
  let tokenId = 0;
  let consecutiveFailures = 0;

  while (consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
    try {
      if (existingIds.has(tokenId)) {
        console.log(`Skipped (exists): tokenId ${tokenId}`);
        tokenId++;
        continue;
      }

      const filename = path.join(OUTPUT_DIR, `${tokenId}.png`);

      const tokenUri = await contract.tokenURI(tokenId);
      const imageUrl = extractImageUrlFromTokenUri(tokenUri);

      if (!imageUrl) {
        console.warn(`No image URL found for tokenId ${tokenId}`);
        consecutiveFailures++;
        tokenId++;
        continue;
      }

      await downloadImage(imageUrl, filename);
      downloadedCount++;
      existingIds.add(tokenId);
      consecutiveFailures = 0;
      if (tokenId > newMaxId) {
        newMaxId = tokenId;
      }

      // Be gentle to RPC / renderer
      await new Promise(r => setTimeout(r, 500));
    } catch (error) {
      console.error(`Error processing tokenId ${tokenId}:`, error.message);
      consecutiveFailures++;
      // Continue with the next tokenId
      tokenId++;
      continue;
    }
  }

  console.log(`Finished processing. Downloaded ${downloadedCount} new images. Max processed ID (approx): ${newMaxId}`);
}

fetchNFTs();
