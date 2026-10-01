/**
 * Starter solution library — loaded into every new workspace so opportunity
 * scoring has something to match against from day one. Without a library the
 * "solution fit" factor is 0 for every opportunity (15% of the score), which
 * caps real leads below the strong threshold.
 *
 * These are TEMPLATES, not claims about what the user sells: descriptions say
 * so, pricing is a starting estimate (never a quotation), and the owner is
 * expected to edit or delete anything that doesn't match their offer.
 * `problems` must be keys of PROBLEM_TYPES (lib/constants.js); together they
 * cover all of them. `industries` use words the matcher understands; empty
 * means "any industry" (neutral fit).
 */

const NOTE = ' Starter template — edit it to match what you actually deliver.';

export const STARTER_SOLUTIONS = [
  {
    name: 'Point of Sale & Sales Tracking',
    description: `In-store sales system with receipts, daily summaries and payment tracking.${NOTE}`,
    problems: ['lost_sales', 'payment_reconciliation', 'reporting', 'operational_inefficiency', 'administrative_inefficiency'],
    industries: ['Retail', 'Restaurants', 'Services'],
    features: ['Receipts', 'Daily summaries', 'Payment tracking'],
    price: [40000, 70000, 120000],
  },
  {
    name: 'Inventory & Stock Management',
    description: `Live stock levels, low-stock alerts, stock counts and shrinkage tracking.${NOTE}`,
    problems: ['inventory_problems', 'lost_sales', 'production_tracking', 'reporting'],
    industries: ['Retail', 'Wholesale', 'Manufacturing', 'Furniture'],
    features: ['Stock levels', 'Low-stock alerts', 'Stock counts'],
    price: [45000, 75000, 130000],
  },
  {
    name: 'Order Management (WhatsApp, phone & walk-in)',
    description: `One place for orders arriving by WhatsApp, phone or in person, with statuses and customer history.${NOTE}`,
    problems: ['manual_ordering', 'order_tracking', 'customer_service', 'lost_sales', 'customer_communication'],
    industries: ['Retail', 'Restaurants', 'Furniture', 'Manufacturing', 'Wholesale'],
    features: ['Order intake', 'Status tracking', 'Customer history'],
    price: [40000, 65000, 110000],
  },
  {
    name: 'Online Booking & Appointments',
    description: `Self-service booking with calendars, reminders and fewer no-shows.${NOTE}`,
    problems: ['manual_booking', 'scheduling', 'customer_communication', 'poor_conversion', 'customer_service'],
    industries: ['Services', 'Healthcare', 'Hospitality'],
    features: ['Online booking', 'Reminders', 'Staff calendars'],
    price: [35000, 60000, 100000],
  },
  {
    name: 'Customer CRM & Follow-up',
    description: `Customer database with follow-up reminders and repeat-business tracking.${NOTE}`,
    problems: ['customer_retention', 'repeat_sales', 'poor_conversion', 'quotation_management', 'customer_communication'],
    industries: [],
    features: ['Customer records', 'Follow-up reminders', 'Deal tracking'],
    price: [35000, 60000, 100000],
  },
  {
    name: 'Online Store & Catalogue',
    description: `Product catalogue with cart, checkout and order notifications so customers can buy without calling.${NOTE}`,
    problems: ['lost_sales', 'poor_conversion', 'repeat_sales', 'customer_retention'],
    industries: ['Retail', 'Fashion'],
    features: ['Catalogue', 'Checkout', 'Order notifications'],
    price: [50000, 90000, 160000],
  },
  {
    name: 'Quotation & Invoicing',
    description: `Professional quotes and invoices with templates, approvals and follow-up reminders.${NOTE}`,
    problems: ['quotation_management', 'administrative_inefficiency', 'payment_reconciliation', 'lost_sales'],
    industries: ['Furniture', 'Manufacturing', 'Services', 'Wholesale'],
    features: ['Quote builder', 'Invoices', 'Follow-up reminders'],
    price: [30000, 50000, 90000],
  },
  {
    name: 'Wholesale Ordering Portal',
    description: `Portal where trade customers see tiered prices and place bulk orders themselves.${NOTE}`,
    problems: ['wholesale_ordering', 'manual_ordering', 'order_tracking', 'quotation_management'],
    industries: ['Wholesale', 'Distribution', 'FMCG'],
    features: ['Tiered pricing', 'Bulk ordering', 'Order history'],
    price: [70000, 120000, 200000],
  },
  {
    name: 'Delivery & Dispatch Management',
    description: `Dispatch board, rider assignment, delivery statuses and proof of delivery.${NOTE}`,
    problems: ['delivery_management', 'scheduling', 'order_tracking', 'customer_communication'],
    industries: ['Logistics', 'Retail', 'Restaurants'],
    features: ['Dispatch board', 'Rider assignment', 'Proof of delivery'],
    price: [45000, 80000, 140000],
  },
  {
    name: 'Restaurant & Cafe Management',
    description: `Menu, table and kitchen ordering with daily sales reconciliation.${NOTE}`,
    problems: ['operational_inefficiency', 'lost_sales', 'payment_reconciliation', 'staff_management', 'manual_ordering'],
    industries: ['Restaurants'],
    features: ['Menu', 'Kitchen tickets', 'Sales reconciliation'],
    price: [60000, 100000, 170000],
  },
  {
    name: 'Staff & Payroll Management',
    description: `Employee records, attendance, leave and payslips.${NOTE}`,
    problems: ['staff_management', 'administrative_inefficiency', 'payment_reconciliation', 'scheduling'],
    industries: [],
    features: ['Employee records', 'Leave', 'Payslips'],
    price: [35000, 60000, 100000],
  },
  {
    name: 'Multi-branch Dashboard & Reporting',
    description: `One view of sales, stock and staff across branches with automated reports.${NOTE}`,
    problems: ['multi_branch_management', 'reporting', 'operational_inefficiency', 'inventory_problems'],
    industries: [],
    features: ['Branch comparison', 'Automated reports', 'Alerts'],
    price: [80000, 140000, 250000],
  },
  {
    name: 'Production & Job Tracking',
    description: `Work orders, production stages and completion tracking against customer orders.${NOTE}`,
    problems: ['production_tracking', 'order_tracking', 'operational_inefficiency', 'quotation_management'],
    industries: ['Manufacturing', 'Furniture'],
    features: ['Work orders', 'Stage tracking', 'Material usage'],
    price: [60000, 100000, 170000],
  },
  {
    name: 'M-Pesa Payment Reconciliation',
    description: `Automatic matching of mobile-money payments to orders and invoices.${NOTE}`,
    problems: ['payment_reconciliation', 'reporting', 'administrative_inefficiency'],
    industries: [],
    features: ['Payment matching', 'Reconciliation reports'],
    price: [30000, 50000, 85000],
  },
  {
    name: 'Customer Support Desk',
    description: `Shared inbox with ticket tracking and response-time monitoring for customer enquiries.${NOTE}`,
    problems: ['customer_service', 'customer_communication'],
    industries: [],
    features: ['Shared inbox', 'Ticket tracking', 'Canned replies'],
    price: [30000, 50000, 85000],
  },
];
