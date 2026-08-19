import type { FieldSpec } from "./schema";

export type Sample = {
  id: string;
  label: string;
  /** One line explaining what this document is meant to prove. Shown under the picker. */
  note: string;
  fields: FieldSpec[];
  text: string;
};

/**
 * Evening 3 replaces these with three documents you write yourself.
 *
 * The design constraint that matters: every sample must request at least one field the
 * document genuinely does not contain. The null path is half the pitch, and a sample
 * where everything resolves demonstrates only the easy half.
 */
export const SAMPLES: Sample[] = [
  {
    id: "services-agreement",
    label: "Services agreement",
    note: "Asks for a termination notice period the contract never states — that field comes back null.",
    fields: [
      {
        key: "client_name",
        label: "Client name",
        type: "string",
        description: "The legal entity receiving the services.",
      },
      {
        key: "effective_date",
        label: "Effective date",
        type: "date",
        description: "The date the agreement takes effect.",
      },
      {
        key: "total_fee_usd",
        label: "Total fee (USD)",
        type: "number",
        description: "Total contract value in US dollars.",
      },
      {
        key: "payment_terms_days",
        label: "Payment terms (days)",
        type: "number",
        description: "Days the client has to pay an invoice after receipt.",
      },
      {
        key: "governing_law",
        label: "Governing law",
        type: "string",
        description: "The jurisdiction whose law governs the agreement.",
      },
      {
        key: "termination_notice_days",
        label: "Termination notice (days)",
        type: "number",
        description:
          "Days of written notice required to terminate for convenience.",
      },
      {
        key: "auto_renews",
        label: "Auto-renews",
        type: "boolean",
        description: "Whether the term renews automatically at expiry.",
      },
    ],
    text: `MASTER SERVICES AGREEMENT

This Master Services Agreement (the "Agreement") is entered into as of
March 14, 2025 (the "Effective Date") by and between Northwind Analytics LLC,
a Delaware limited liability company ("Provider"), and Harbourline Freight, Inc.,
a New York corporation ("Client").

1. SERVICES
Provider shall perform the data engineering services described in Exhibit A.
Provider shall assign a named technical lead within ten (10) business days of the
Effective Date.

2. TERM
The initial term of this Agreement is twelve (12) months from the Effective Date.
The Agreement does not renew automatically; any extension requires a written
amendment signed by both parties.

3. FEES AND PAYMENT
In consideration of the Services, Client shall pay Provider a total fee of
$148,500. Provider shall invoice Client monthly in arrears. Client shall pay each
undisputed invoice within thirty (30) days of receipt. Amounts not paid when due
accrue interest at 1.0% per month.

4. CONFIDENTIALITY
Each party shall protect the other's Confidential Information using no less than
reasonable care, and shall not disclose it to any third party except to employees
and contractors with a need to know who are bound by comparable obligations.

5. GOVERNING LAW
This Agreement is governed by the laws of the State of New York, without regard
to its conflict of laws principles. The parties consent to the exclusive
jurisdiction of the state and federal courts located in New York County.

6. ENTIRE AGREEMENT
This Agreement, together with its Exhibits, constitutes the entire agreement
between the parties and supersedes all prior discussions.`,
  },
];

export const DEFAULT_SAMPLE = SAMPLES[0];
