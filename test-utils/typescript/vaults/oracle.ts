import { BN } from "@coral-xyz/anchor";
import { bnToBigInt } from "../bn";

export class PythV2BufferUpdater {
  // Offsets for PriceUpdateV2 structure
  private static readonly BASE_OFFSET = 8;
  private static readonly WRITE_AUTHORITY_OFFSET = 0 + this.BASE_OFFSET;
  private static readonly VERIFICATION_LEVEL_OFFSET = 32 + this.BASE_OFFSET;
  private static readonly PRICE_MESSAGE_OFFSET = 33 + this.BASE_OFFSET;

  // Offsets within PriceFeedMessage (starting from PRICE_MESSAGE_OFFSET)
  private static readonly FEED_ID_OFFSET = 0;
  private static readonly PRICE_OFFSET = 32;
  private static readonly CONF_OFFSET = 40;
  private static readonly EXPONENT_OFFSET = 48;
  private static readonly PUBLISH_TIME_OFFSET = 52;
  private static readonly PREV_PUBLISH_TIME_OFFSET = 60;
  private static readonly EMA_PRICE_OFFSET = 68;
  private static readonly EMA_CONF_OFFSET = 76;
  private static readonly POSTED_SLOT_OFFSET = 84;

  static readPrice(buffer: Buffer): bigint {
    const offset = this.PRICE_MESSAGE_OFFSET + this.PRICE_OFFSET;
    return buffer.readBigInt64LE(offset);
  }

  static readConf(buffer: Buffer): bigint {
    const offset = this.PRICE_MESSAGE_OFFSET + this.CONF_OFFSET;
    return buffer.readBigUInt64LE(offset);
  }

  static readExponent(buffer: Buffer): number {
    const offset = this.PRICE_MESSAGE_OFFSET + this.EXPONENT_OFFSET;
    return buffer.readInt32LE(offset);
  }

  static readPublishTime(buffer: Buffer): bigint {
    const offset = this.PRICE_MESSAGE_OFFSET + this.PUBLISH_TIME_OFFSET;
    return buffer.readBigInt64LE(offset);
  }

  static updatePrice(
    originalBuffer: Buffer,
    newPrice: BN,
    timestamp: number
  ): Buffer {
    const modifiedBuffer = Buffer.from(originalBuffer);

    // Update price
    const priceOffset = this.PRICE_MESSAGE_OFFSET + this.PRICE_OFFSET;
    modifiedBuffer.writeBigInt64LE(bnToBigInt(newPrice), priceOffset);

    // Update publish time
    const publishTimeOffset =
      this.PRICE_MESSAGE_OFFSET + this.PUBLISH_TIME_OFFSET;
    const currentTime = BigInt(timestamp);
    modifiedBuffer.writeBigInt64LE(currentTime, publishTimeOffset);

    // Update posted slot
    const postedSlotOffset =
      this.PRICE_MESSAGE_OFFSET + this.POSTED_SLOT_OFFSET;
    const currentSlot = modifiedBuffer.readBigUInt64LE(postedSlotOffset);
    modifiedBuffer.writeBigUInt64LE(currentSlot + BigInt(1), postedSlotOffset);

    return modifiedBuffer;
  }

  static logCurrentData(buffer: Buffer) {
    console.log("Current Pyth V2 Data:", {
      price: this.readPrice(buffer).toString(),
      conf: this.readConf(buffer).toString(),
      exponent: this.readExponent(buffer),
      publishTime: this.readPublishTime(buffer).toString(),
    });
  }
}
