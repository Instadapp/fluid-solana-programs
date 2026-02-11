import { PublicKey } from "@solana/web3.js";
import { BorshCoder, EventParser, Idl } from "@coral-xyz/anchor";

import lendingJson from "../target/idl/lending.json";
import { connection } from "../ts-sdk/connection";

const parseEvents = async () => {
  const lendingProgram = new PublicKey(lendingJson.address);

  const allTxs = await connection.getSignaturesForAddress(lendingProgram, {
    limit: 1000,
  });
  console.log(allTxs[0]);

  const eventParser = new EventParser(
    lendingProgram,
    new BorshCoder(lendingJson as unknown as Idl)
  );

  for (let tx of allTxs) {
    const transaction = await connection.getParsedTransaction(tx.signature, {
      maxSupportedTransactionVersion: 0,
    });

    const events = eventParser.parseLogs(transaction?.meta?.logMessages!);
    for (let event of events) {
      console.log("--------- Trade Event Data ------------");
      console.log(event);
    }
  }
};

parseEvents();
