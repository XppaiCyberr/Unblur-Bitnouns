# Unblur Bitnouns

Bitnouns NFTs have been showing up blurred on OpenSea (and elsewhere) for a long time. This project fetches the collection, **unblurs** each image using a pixel-grid trick, and saves sharp 512×512 versions. It makes me happy to finally see my Bitnouns the way they’re supposed to look.

# Before - After
<img width="512" height="512" alt="image" src="https://github.com/user-attachments/assets/fdfdfad9-f34c-41aa-99c3-3310f10d0c68" />
<img width="512" height="512" alt="ab-ezgif com-webp-to-png-converter" src="https://github.com/user-attachments/assets/9bf1a47f-9da9-4293-a604-dfd0ec8280ee" />

## How it works

1. **Fetch** – The script reads `tokenURI(tokenId)` directly from the BitNouns ERC‑721 contract on Ethereum, decodes the base64 JSON metadata, and pulls the `image` URL for each token. It uses the on-chain contract as the source of truth instead of the OpenSea API.

2. **Unblur** – Each image is treated as a **32×32 grid** of “logical” pixels. For every cell we take the **center pixel**, which gives a clean 32×32 image. That is then **upscaled to 512×512** with **nearest-neighbor** interpolation (no smoothing), so you get sharp pixel-art instead of a blur.

3. **Save** – Processed images are written as PNGs to the `images/` folder. If unblur fails for an image (e.g. corrupt or unsupported), the original is saved instead so nothing is lost.

So in short: **blurry image in → grid sampling + nearest-neighbor upscale → sharp Bitnouns out.**

## Run locally

**Requirements:** Node.js 20+, pnpm.

```bash
pnpm install
```

The script uses a public Ethereum RPC endpoint by default (see `rpcUrl` in `index.js`).  
If you prefer a different provider (Infura, Alchemy, Ankr, etc.), edit that constant.

Then:

```bash
node index.js
```

Images are saved under `images/` as `{identifier}.png`.

## GitHub Actions

The repo has a workflow that:

- Runs on **push to `main`**, **manual trigger**, and **daily** (midnight UTC).
- Fetches and unblurs all Bitnouns, then:
  - Uploads the `images/` folder as a **workflow artifact** (download from the run).
  - **Commits and pushes** the images into the repo’s `images/` folder so they’re visible on GitHub.

The workflow currently assumes the same RPC settings as your local script. If you change
the `rpcUrl` in `index.js`, update the workflow if needed.

## Use the Images

All images are committed to this repo's `images/` (unblurred) and `images-blurred/` (originals) folders. You can embed them directly in your project using the **GitHub raw URL** as a free CDN.

### URL Format

```
https://raw.githubusercontent.com/XppaiCyberr/Unblur-Bitnouns/main/images/{tokenId}.png
```

Replace `{tokenId}` with the token number (e.g. `0`, `42`, `517`).

| Variant | URL |
|---------|-----|
| **Unblurred** (sharp 512×512) | `https://raw.githubusercontent.com/XppaiCyberr/Unblur-Bitnouns/main/images/445.png` |
| **Original** (blurred) | `https://raw.githubusercontent.com/XppaiCyberr/Unblur-Bitnouns/main/images-blurred/445.png` |

### Examples

**Markdown:**

```markdown
![BitNoun #42](https://raw.githubusercontent.com/XppaiCyberr/Unblur-Bitnouns/main/images/445.png)
```

**HTML:**

```html
<img src="https://raw.githubusercontent.com/XppaiCyberr/Unblur-Bitnouns/main/images/445.png" alt="BitNoun #445" width="128" height="128" />
```

**JavaScript (dynamic):**

```js
const tokenId = 42;
const imageUrl = `https://raw.githubusercontent.com/XppaiCyberr/Unblur-Bitnouns/main/images/${tokenId}.png`;
```

> **Note:** GitHub raw URLs are rate-limited. For high-traffic production apps, consider downloading the images and hosting them on your own CDN or using a service like [jsDelivr](https://www.jsdelivr.com/?docs=gh) which caches GitHub files:
>
> ```
> https://cdn.jsdelivr.net/gh/XppaiCyberr/Unblur-Bitnouns@main/images/445.png
> ```
## License

MIT
