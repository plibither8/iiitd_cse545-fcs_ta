const fs = require("fs");
const path = require("path");
const { Network, Alchemy } = require("alchemy-sdk");
const assert = require("assert");

// ! path to current directory; change this to your directory path
const DIRNAME = __dirname;

const alchemyE = new Alchemy({
  apiKey: "TMTprCe3s7L9t8UtGH_Szie1XDIs8f1m",
  network: Network.ETH_GOERLI,
});

const alchemyP = new Alchemy({
  apiKey: "TMTprCe3s7L9t8UtGH_Szie1XDIs8f1m",
  network: Network.POLYGON_MUMBAI,
});

const transform = (nftDetails) => {
  const pattern = /0x[0-9a-f]{40}/;
  if (!pattern.test(nftDetails.contract_address)) return;
  nftDetails.contract_address = nftDetails.contract_address
    .toLowerCase()
    .match(pattern)[0];
};

const getNFTInfo = async (nftDetails) => {
  transform(nftDetails);
  const ownerAddr = nftDetails.metamask_public_address;

  try {
    const nftsForOwnerE = await alchemyE.nft.getNftsForOwner(ownerAddr);
    const nftsForOwnerP = await alchemyP.nft.getNftsForOwner(ownerAddr);
    assert(
      nftsForOwnerE.totalCount > 0 || nftsForOwnerP.totalCount > 0,
      "No NFT found; Score: 0/17"
    );

    const alchemy = nftsForOwnerE.totalCount > 0 ? alchemyE : alchemyP;
    const nftsForOwner =
      nftsForOwnerE.totalCount > 0 ? nftsForOwnerE : nftsForOwnerP;

    const existingToken = nftsForOwner.ownedNfts.find(
      (nft) =>
        nft.contract.address.toLowerCase() ===
        nftDetails.contract_address.toLowerCase()
    );
    assert(
      existingToken,
      "No NFT minted for given user & contract address; Score: 3/17"
    );

    const metadata = await alchemy.nft.getNftMetadata(
      nftDetails.contract_address,
      existingToken.tokenId
    );
    assert(metadata, "No metadata found for given NFT; Score: 6/17");
    assert(
      metadata.contract.tokenType === "ERC721",
      "Not an ERC721; Score: 12/17"
    );

    const pattern = /Qm[0-9a-zA-Z]{44}/;
    const possibleCids = [
      metadata.rawMetadata?.image,
      metadata.tokenUri.raw,
      metadata.tokenUri.gateway,
      ...metadata.media.flatMap((media) => [media.raw, media.gateway]),
    ]
      .map((cid) => [cid, cid?.match(pattern)?.[0]])
      .flat()
      .filter(Boolean);
    const imageCid =
      metadata.tokenUri.raw.match(pattern)?.[0] ?? metadata.tokenUri.raw;

    assert(
      [nftDetails.image_ipfs_cid, nftDetails.metadata_ipfs_cid].some((cid) =>
        possibleCids.includes(cid)
      ),
      "Image CID mismatch; Score: 14/17"
    );

    console.log("All fields verified! Score: 17/17");
  } catch (e) {
    console.log(e.message);
  }
};

const main = async () => {
  const nftDetails = JSON.parse(
    fs.readFileSync(path.join(DIRNAME, "nft-details.json"))
  );
  await getNFTInfo(nftDetails);
};

main();
