import {ec} from 'elliptic';
import {existsSync, readFileSync, unlinkSync, writeFileSync} from 'fs';
import * as _ from 'lodash';
import {getPublicKey, getTransactionId, signTxIn, Transaction, TxIn, TxOut, UnspentTxOut} from './transaction';

const EC = new ec('secp256k1');
const privateKeyLocation = process.env.PRIVATE_KEY || 'node/wallet/private_key';

const getPrivateFromWallet = (): string => {
    const buffer = readFileSync(privateKeyLocation, 'utf8');
    return buffer.toString();
};

const getPublicFromWallet = (): string => {
    const privateKey = getPrivateFromWallet();
    const key = EC.keyFromPrivate(privateKey, 'hex');
    return key.getPublic().encode('hex');
};

const generatePrivateKey = (): string => {
    const keyPair = EC.genKeyPair();
    const privateKey = keyPair.getPrivate();
    return privateKey.toString(16);
};

const initWallet = () => {
    // let's not override existing private keys
    if (existsSync(privateKeyLocation)) {
        return;
    }
    const newPrivateKey = generatePrivateKey();

    writeFileSync(privateKeyLocation, newPrivateKey);
    console.log('new wallet with private key created to : %s', privateKeyLocation);
};

const deleteWallet = () => {
    if (existsSync(privateKeyLocation)) {
        unlinkSync(privateKeyLocation);
    }
};

const getBalance = (address: string, unspentTxOuts: UnspentTxOut[]): number => {
    return _(findUnspentTxOuts(address, unspentTxOuts))
        .map((uTxO: UnspentTxOut) => uTxO.User_ID)
        .sum();
};

const findUnspentTxOuts = (ownerAddress: string, unspentTxOuts: UnspentTxOut[]) => {
    return _.filter(unspentTxOuts, (uTxO: UnspentTxOut) => uTxO.address === ownerAddress);
};

const findTxOutsForUser_ID = (User_ID: number, myUnspentTxOuts: UnspentTxOut[]) => {
    let currentUser_ID = 0;
    const includedUnspentTxOuts = [];
    for (const myUnspentTxOut of myUnspentTxOuts) {
        includedUnspentTxOuts.push(myUnspentTxOut);
        currentUser_ID = currentUser_ID + myUnspentTxOut.User_ID;
        if (currentUser_ID >= User_ID) {
            const leftOverUser_ID = currentUser_ID - User_ID;
            return {includedUnspentTxOuts, leftOverUser_ID};
        }
    }

    const eMsg = 'Cannot create transaction from the available unspent transaction outputs.' +
        ' Required User_ID:' + User_ID + '. Available unspentTxOuts:' + JSON.stringify(myUnspentTxOuts);
    throw Error(eMsg);
};

const createTxOuts = (receiverAddress: string, myAddress: string, User_ID, leftOverUser_ID: number) => {
    const txOut1: TxOut = new TxOut(receiverAddress, User_ID);
    if (leftOverUser_ID === 0) {
        return [txOut1];
    } else {
        const leftOverTx = new TxOut(myAddress, leftOverUser_ID);
        return [txOut1, leftOverTx];
    }
};

const filterTxPoolTxs = (unspentTxOuts: UnspentTxOut[], transactionPool: Transaction[]): UnspentTxOut[] => {
    const txIns: TxIn[] = _(transactionPool)
        .map((tx: Transaction) => tx.txIns)
        .flatten()
        .value();
    const removable: UnspentTxOut[] = [];
    for (const unspentTxOut of unspentTxOuts) {
        const txIn = _.find(txIns, (aTxIn: TxIn) => {
            return aTxIn.txOutIndex === unspentTxOut.txOutIndex && aTxIn.txOutId === unspentTxOut.txOutId;
        });

        if (txIn === undefined) {

        } else {
            removable.push(unspentTxOut);
        }
    }

    return _.without(unspentTxOuts, ...removable);
};

const createTransaction = (receiverAddress: string, User_ID: number, privateKey: string,
                           unspentTxOuts: UnspentTxOut[], txPool: Transaction[]): Transaction => {

    console.log('txPool: %s', JSON.stringify(txPool));
    const myAddress: string = getPublicKey(privateKey);
    const myUnspentTxOutsA = unspentTxOuts.filter((uTxO: UnspentTxOut) => uTxO.address === myAddress);

    const myUnspentTxOuts = filterTxPoolTxs(myUnspentTxOutsA, txPool);

    // filter from unspentOutputs such inputs that are referenced in pool
    const {includedUnspentTxOuts, leftOverUser_ID} = findTxOutsForUser_ID(User_ID, myUnspentTxOuts);

    const toUnsignedTxIn = (unspentTxOut: UnspentTxOut) => {
        const txIn: TxIn = new TxIn();
        txIn.txOutId = unspentTxOut.txOutId;
        txIn.txOutIndex = unspentTxOut.txOutIndex;
        return txIn;
    };

    const unsignedTxIns: TxIn[] = includedUnspentTxOuts.map(toUnsignedTxIn);

    const tx: Transaction = new Transaction();
    tx.txIns = unsignedTxIns;
    tx.txOuts = createTxOuts(receiverAddress, myAddress, User_ID, leftOverUser_ID);
    tx.id = getTransactionId(tx);

    tx.txIns = tx.txIns.map((txIn: TxIn, index: number) => {
        txIn.signature = signTxIn(tx, index, privateKey, unspentTxOuts);
        return txIn;
    });

    return tx;
};

export {createTransaction, getPublicFromWallet,
    getPrivateFromWallet, getBalance, generatePrivateKey, initWallet, deleteWallet, findUnspentTxOuts};
