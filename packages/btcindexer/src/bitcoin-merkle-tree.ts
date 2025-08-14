import { createHash } from "crypto";
import { Transaction } from "bitcoinjs-lib";

function sha256(data: Buffer): Buffer {
	return createHash("sha256").update(data).digest();
}

interface MerkleNode {
	hash: Buffer;
	preimage: Buffer;
}

export class BitcoinMerkleTree {
	private tree: MerkleNode[][];
	private readonly root: Buffer;

	constructor(transactions: Transaction[]) {
		if (!transactions || transactions.length === 0) {
			throw new Error("Cannot construct Merkle tree from empty transaction list.");
		}
		const leafNodes: MerkleNode[] = transactions.map((tx) => {
			return {
				hash: tx.getHash(),
				preimage: sha256(tx.toBuffer()),
			};
		});

		this.tree = [leafNodes];
		this.buildTree();
		this.root = this.tree[this.tree.length - 1][0].hash;
	}

	private buildTree(): void {
		let currentLevel = this.tree[0];
		while (currentLevel.length > 1) {
			const nextLevel: MerkleNode[] = [];

			if (currentLevel.length % 2 === 1) {
				currentLevel.push(currentLevel[currentLevel.length - 1]);
			}

			for (let i = 0; i < currentLevel.length; i += 2) {
				const left = currentLevel[i];
				const right = currentLevel[i + 1];

				const combined = Buffer.concat([left.hash, right.hash]);
				nextLevel.push({
					hash: sha256(sha256(combined)),
					preimage: sha256(combined),
				});
			}
			currentLevel = nextLevel;
			this.tree.push(currentLevel);
		}
	}

	public getRoot(bigEndian = false): Buffer {
		return bigEndian ? Buffer.from(this.root).reverse() : this.root;
	}

	public getProof(targetTx: Transaction): Buffer[] {
		const proof: Buffer[] = [];
		const targetHash = targetTx.getHash();

		let targetIndex = this.tree[0].findIndex((node) => node.hash.equals(targetHash));
		if (targetIndex === -1) {
			throw new Error("Target leaf not found in the tree.");
		}

		for (let level = 0; level < this.tree.length - 1; level++) {
			const currentLevelNodes = this.tree[level];
			let siblingIndex: number;

			const isRightNode = targetIndex % 2 === 1;
			const isLastNodeOnLevel = targetIndex === currentLevelNodes.length - 1;
			const levelHasOddNodes = currentLevelNodes.length % 2 === 1;

			if (isLastNodeOnLevel && levelHasOddNodes) {
				siblingIndex = targetIndex;
			} else if (isRightNode) {
				siblingIndex = targetIndex - 1;
			} else {
				siblingIndex = targetIndex + 1;
			}

			const siblingNode = currentLevelNodes[siblingIndex];
			proof.push(siblingNode.preimage);

			targetIndex = Math.floor(targetIndex / 2);
		}
		return proof;
	}
}
