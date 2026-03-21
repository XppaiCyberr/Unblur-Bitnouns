import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';
import { unblurImage } from './unblur.js';

const rpcUrl = "https://eth-mainnet.g.alchemy.com/v2/vQGyxhOFF05Xc6ekLTsRC";

const CONTRACT_ADDRESS = '0xd7cb208297f661867a43c08afe5980ee88dfc678';
const AUCTION_CONTRACT_ADDRESS = '0xA227441A4FA9b44ceC257D539dF8e4F80A491b80';
const OUTPUT_DIR = path.join(process.cwd(), 'images');
const BLURRED_OUTPUT_DIR = path.join(process.cwd(), 'images-blurred');

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
  const tokenName = path.basename(filename, '.png');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.statusText}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    const originalSize = (buffer.length / 1024).toFixed(1);

    // Save original blurred image alongside the unblurred version
    let blurredSaved = false;
    try {
      const blurredFilename = path.join(BLURRED_OUTPUT_DIR, path.basename(filename));
      await fs.promises.writeFile(blurredFilename, buffer);
      blurredSaved = true;
    } catch (err) {
      console.warn(`  ⚠ Failed to save blurred original for token ${tokenName}: ${err.message}`);
    }

    let toWrite = buffer;
    let unblurred = false;
    try {
      toWrite = await unblurImage(buffer);
      unblurred = true;
    } catch (err) {
      console.warn(`  ⚠ Unblur failed for token ${tokenName}, saving original instead: ${err.message}`);
    }

    const finalSize = (toWrite.length / 1024).toFixed(1);
    await fs.promises.writeFile(filename, toWrite);

    const savedType = unblurred ? '✓ unblurred' : '⚠ original (unblur failed)';
    const blurredStatus = blurredSaved ? '✓ saved' : '✗ failed';
    console.log(`  Token #${tokenName} | ${savedType} (${finalSize}KB) | blurred original: ${blurredStatus} (${originalSize}KB)`);
  } catch (error) {
    console.error(`  ✗ Token #${tokenName} failed: ${error.message}`);
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

async function getCurrentTokenId(provider) {
  const auctionAbi = ['function auction() view returns (uint256 tokenId, uint256 highestBid, address highestBidder, uint40 startTime, uint40 endTime, bool settled)'];
  const auctionContract = new ethers.Contract(AUCTION_CONTRACT_ADDRESS, auctionAbi, provider);
  const auctionData = await auctionContract.auction();
  return Number(auctionData.tokenId);
}

async function fetchNFTs() {
  const { maxId: maxProcessedId, existingIds } = await getTokenState(OUTPUT_DIR);
  let downloadedCount = 0;
  let newMaxId = maxProcessedId;

  // Ensure blurred output directory exists up front so the folder is always created
  try {
    if (!fs.existsSync(BLURRED_OUTPUT_DIR)) {
      fs.mkdirSync(BLURRED_OUTPUT_DIR, { recursive: true });
    }
  } catch (err) {
    console.warn('Failed to ensure blurred images directory exists:', err.message);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // Get the current token ID from the auction contract (realtime max supply)
  const currentTokenId = await getCurrentTokenId(provider);
  console.log(`Current auction token ID (max supply): ${currentTokenId}`);
  console.log(`Detected max processed ID on disk: ${maxProcessedId}`);
  console.log(`Fetching NFTs directly from contract: ${CONTRACT_ADDRESS}...`);

  const abi = ['function tokenURI(uint256 tokenId) view returns (string)'];
  const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);

  const CONCURRENCY = 5;
  const targetMaxId = currentTokenId;
  let tokenId = 0;

  // Download all tokenIds from 0 up to the current auction token ID.
  // This ensures we always sync up to the latest minted token.
  while (tokenId <= targetMaxId) {
    // Build a batch of tokenIds to process in parallel, bounded by targetMaxId
    const batchIds = [];
    for (let i = 0; i < CONCURRENCY && tokenId <= targetMaxId; i++) {
      batchIds.push(tokenId);
      tokenId++;
    }

    if (batchIds.length === 0) break;

    const results = await Promise.all(batchIds.map(async (id) => {
      const filename = path.join(OUTPUT_DIR, `${id}.png`);
      const blurredFilename = path.join(BLURRED_OUTPUT_DIR, `${id}.png`);

      // Fast skip: if we already have both unblurred and blurred images, assume it's fully processed.
      if (fs.existsSync(filename) && fs.existsSync(blurredFilename)) {
        console.log(`Skipped (already processed): tokenId ${id}`);
        return false; // not a new download
      }

      try {
        const tokenUri = await contract.tokenURI(id);
        const imageUrl = extractImageUrlFromTokenUri(tokenUri);

        if (!imageUrl) {
          console.warn(`No image URL found for tokenId ${id}`);
          return false;
        }

        await downloadImage(imageUrl, filename);
        downloadedCount++;
        if (id > newMaxId) {
          newMaxId = id;
        }

        // Small delay per token to avoid overloading RPC/renderer
        await new Promise(r => setTimeout(r, 100));
        return true;
      } catch (error) {
        console.error(`Error processing tokenId ${id}:`, error.message);
        return false;
      }
    }));
  }

  console.log(`Finished processing. Downloaded ${downloadedCount} new images. Max processed ID (approx): ${newMaxId}`);
}

fetchNFTs();
