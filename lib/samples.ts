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
 * Three documents, written for this repo — no third-party text, nothing scraped, every
 * name and number invented.
 *
 * The design constraint that matters: every sample must request at least one field the
 * document genuinely does not contain. The null path is half the pitch, and a sample
 * where everything resolves demonstrates only the easy half.
 *
 * A second, subtler constraint on the absent fields: the document must contain nothing
 * that could be *quoted* in support of a fabricated answer. Citation verification proves
 * a quote exists in the source, not that it supports the value — so asking for a flood
 * deductible in a policy that lists a wind deductible would let a wrong answer arrive
 * with a real quote attached and pass. The absences here have no near-miss text to grab,
 * which is what makes them honest tests rather than coin flips.
 *
 * Between them the three cover the conversions worth showing: dates in three formats,
 * currency and separators stripped to bare numbers, enums, list fields, and booleans.
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

  {
    id: "commercial-invoice",
    label: "Commercial invoice",
    note: "No purchase order number anywhere on the invoice — that field comes back null, and so does the discount flag.",
    fields: [
      {
        key: "invoice_number",
        label: "Invoice number",
        type: "string",
        description: "The vendor's identifier for this invoice.",
      },
      {
        key: "invoice_date",
        label: "Invoice date",
        type: "date",
        description: "The date the invoice was issued.",
      },
      {
        key: "due_date",
        label: "Due date",
        type: "date",
        description: "The date payment is due.",
      },
      {
        key: "vendor_name",
        label: "Vendor",
        type: "string",
        description: "The legal entity issuing the invoice.",
      },
      {
        key: "bill_to_company",
        label: "Bill to",
        type: "string",
        description: "The company being billed.",
      },
      {
        key: "total_due_usd",
        label: "Total due (USD)",
        type: "number",
        description: "The final amount payable, after tax.",
      },
      {
        key: "line_item_descriptions",
        label: "Line items",
        type: "string_list",
        description: "The description text of each billed line item.",
      },
      {
        key: "payment_method",
        label: "Payment method",
        type: "enum",
        description: "How the vendor asks to be paid.",
        enumValues: ["ACH", "Wire", "Check", "Credit card"],
      },
      {
        key: "late_fee_monthly_percent",
        label: "Late fee (% per month)",
        type: "number",
        description: "Monthly interest rate applied to overdue balances.",
      },
      {
        key: "purchase_order_number",
        label: "Purchase order number",
        type: "string",
        description: "The buyer's PO number referenced by this invoice.",
      },
      {
        key: "discount_applied",
        label: "Discount applied",
        type: "boolean",
        description: "Whether any discount was applied to this invoice.",
      },
    ],
    text: `NORTHWIND ANALYTICS LLC
1400 Alder Street, Suite 220
Portland, OR 97209

INVOICE

Invoice Number:   NW-2025-0417
Invoice Date:     8 April 2025
Due Date:         8 May 2025

Bill To:
Harbourline Freight, Inc.
Attn: Accounts Payable
55 Water Street, 12th Floor
New York, NY 10041

Description                                   Qty        Rate        Amount
---------------------------------------------------------------------------
Data pipeline migration, March 2025        64 hrs     $185.00    $11,840.00
Warehouse schema review                    12 hrs     $185.00     $2,220.00
On-call support retainer, March 2025         1 mo   $1,500.00     $1,500.00
---------------------------------------------------------------------------
                                                     Subtotal    $15,560.00
                                                     Tax (0%)         $0.00
                                                     TOTAL DUE   $15,560.00

Remit by ACH to Cascade Commerce Bank, account ending 4417.

Payment is due within thirty (30) days of the invoice date. Balances
outstanding after the due date accrue interest at 1.5% per month.

Questions about this invoice? Write to billing@northwind.example.`,
  },

  {
    id: "insurance-declarations",
    label: "Insurance declarations",
    note: "Asks whether earthquake coverage is included. The policy never mentions earthquakes — so the answer is null, not a guess from the perils it does list.",
    fields: [
      {
        key: "policy_number",
        label: "Policy number",
        type: "string",
        description: "The insurer's identifier for this policy.",
      },
      {
        key: "named_insured",
        label: "Named insured",
        type: "string",
        description: "The person or entity insured under this policy.",
      },
      {
        key: "insured_property_address",
        label: "Insured property",
        type: "string",
        description: "The street address of the property covered.",
      },
      {
        key: "policy_effective_date",
        label: "Effective date",
        type: "date",
        description: "The date coverage begins.",
      },
      {
        key: "policy_expiration_date",
        label: "Expiration date",
        type: "date",
        description: "The date coverage ends.",
      },
      {
        key: "dwelling_coverage_limit_usd",
        label: "Dwelling limit (USD)",
        type: "number",
        description: "The limit of liability for Coverage A — Dwelling.",
      },
      {
        key: "windstorm_deductible_usd",
        label: "Windstorm deductible (USD)",
        type: "number",
        description: "The deductible that applies to windstorm or hail losses.",
      },
      {
        key: "total_annual_premium_usd",
        label: "Annual premium (USD)",
        type: "number",
        description: "The total premium for the policy period.",
      },
      {
        key: "policy_form",
        label: "Policy form",
        type: "enum",
        description: "The homeowners policy form this policy is written on.",
        enumValues: ["HO-2", "HO-3", "HO-5", "HO-6", "HO-8"],
      },
      {
        key: "mortgagee_name",
        label: "Mortgagee",
        type: "string",
        description: "The lender named as mortgagee on the policy.",
      },
      {
        key: "earthquake_coverage_included",
        label: "Earthquake coverage",
        type: "boolean",
        description: "Whether this policy includes coverage for earthquake damage.",
      },
    ],
    text: `CASCADE MUTUAL INSURANCE COMPANY
HOMEOWNERS POLICY — DECLARATIONS PAGE

Policy Number:      HO-4471902
Named Insured:      Dolores M. Ferraro
Insured Property:   812 Kestrel Lane, Asheville, NC 28801
Policy Period:      From 01/15/2025 to 01/15/2026
                    12:01 A.M. standard time at the insured property

COVERAGES AND LIMITS OF LIABILITY

  Coverage A — Dwelling                                  $412,000
  Coverage B — Other Structures                           $41,200
  Coverage C — Personal Property                         $206,000
  Coverage D — Loss of Use                                $82,400
  Coverage E — Personal Liability (each occurrence)      $300,000
  Coverage F — Medical Payments (each person)              $5,000

DEDUCTIBLES

  All Other Perils                                         $1,500
  Windstorm or Hail                                        $4,120

Total Annual Premium:                                    $2,847.00

Premium is payable in full or in twelve monthly installments.

FORMS AND ENDORSEMENTS APPLYING TO THIS POLICY

  HO-3 Special Form
  HO-04-90 Personal Property Replacement Cost
  HO-04-16 Premises Alarm or Fire Protection System Credit

Mortgagee: Tarheel Savings Bank, ISAOA/ATIMA, Loan No. 8845120

This declarations page replaces any previously issued declarations page
bearing the policy number and policy period shown above.`,
  },
];

export const DEFAULT_SAMPLE = SAMPLES[0];
