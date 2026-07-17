import type { Principal } from '@seqora/contracts'

export interface CreditLedger {
  reserve(principal: Principal, credits: number, referenceId: string): Promise<void>
}

export class DemoCreditLedger implements CreditLedger {
  async reserve(_principal: Principal, _credits: number, _referenceId: string): Promise<void> {
    // Production adapters must reserve credits atomically and make retries idempotent.
  }
}
