-- 008_solution_library.sql — Configurable Solution Library.
-- Adds feature/demo metadata and low/base/high project-value pricing to the
-- solutions table, then re-prices the initial library in KES and renames the
-- entries to the canonical capability list. Project value is configured here and
-- by the admin UI — the AI never invents project prices.

ALTER TABLE solutions
  ADD COLUMN features            TEXT NULL,
  ADD COLUMN demo_template       VARCHAR(255) NULL,
  ADD COLUMN project_value_low   DECIMAL(12,2) NULL,
  ADD COLUMN project_value_base  DECIMAL(12,2) NULL,
  ADD COLUMN project_value_high  DECIMAL(12,2) NULL;

-- Backfill the new pricing columns from the legacy min/max range so existing
-- rows are not left without a project value. base = midpoint of the range.
UPDATE solutions
  SET project_value_low = COALESCE(project_value_low, minimum_project_value),
      project_value_high = COALESCE(project_value_high, maximum_project_value),
      project_value_base = COALESCE(project_value_base,
        ROUND((COALESCE(project_value_low, minimum_project_value)
             + COALESCE(project_value_high, maximum_project_value)) / 2, 2));

-- ----------------------------------------------------------------------
-- Canonical initial Solution Library (user's deliverable capabilities).
-- project_value_* are typical charge-out figures in KES (low/base/high).
-- Updates are keyed by slug so this is safe to re-run.
-- ----------------------------------------------------------------------
UPDATE solutions SET name='POS', currency='KES',
  project_value_low=45000, project_value_base=65000, project_value_high=100000,
  features='Sales and receipts,shift and cashier management,daily summaries,payment tracking,returns and refunds,basic product catalogue',
  demo_template='ts-mobile-pos'
  WHERE slug='point-of-sale';
UPDATE solutions SET name='ERP', currency='KES',
  project_value_low=200000, project_value_base=350000, project_value_high=600000,
  features='Sales,purchasing,stock,accounting,multi-branch consolidation,role-based access,reports and dashboards',
  demo_template='ts-erp'
  WHERE slug='erp-system';
UPDATE solutions SET name='Inventory Management', currency='KES',
  project_value_low=60000, project_value_base=90000, project_value_high=150000,
  features='Live stock levels,low-stock alerts,stock counts,shrinkage tracking,purchase suggestions,multi-warehouse',
  demo_template='ts-inventory'
  WHERE slug='inventory-management';
UPDATE solutions SET name='Booking System', currency='KES',
  project_value_low=40000, project_value_base=60000, project_value_high=100000,
  features='Online self-service booking,reminders,staff calendars,slot management,payment capture',
  demo_template='ts-booking'
  WHERE slug='booking-system';
UPDATE solutions SET name='CRM', currency='KES',
  project_value_low=50000, project_value_base=75000, project_value_high=120000,
  features='Customer database,deal tracking,communication history,follow-up reminders,segments,tasks',
  demo_template='ts-crm'
  WHERE slug='crm';
UPDATE solutions SET name='Restaurant Management', currency='KES',
  project_value_low=90000, project_value_base=140000, project_value_high=240000,
  features='Menu management,table service,kitchen tickets,waiter ordering,daily reconciliation,table reservations',
  demo_template='ts-restaurant'
  WHERE slug='restaurant-management';
UPDATE solutions SET name='Hotel Management', currency='KES',
  project_value_low=100000, project_value_base=160000, project_value_high=280000,
  features='Room availability,reservations,check-in/out,housekeeping status,occupancy reports,rate plans',
  demo_template='ts-hotel'
  WHERE slug='hotel-management';
UPDATE solutions SET name='Clinic Management', currency='KES',
  project_value_low=90000, project_value_base=140000, project_value_high=240000,
  features='Patient records,appointment queues,prescriptions,visit billing,IPD/OPD flows,doctor schedules',
  demo_template='ts-clinic'
  WHERE slug='clinic-management';
UPDATE solutions SET name='School Management', currency='KES',
  project_value_low=110000, project_value_base=170000, project_value_high=300000,
  features='Enrolment,attendance,fee tracking,parent communication,report cards,staff records',
  demo_template='ts-school'
  WHERE slug='school-management';
UPDATE solutions SET name='HR Management', currency='KES',
  project_value_low=60000, project_value_base=90000, project_value_high=160000,
  features='Employee records,leave requests,contracts,document management,approval workflows',
  demo_template='ts-hr'
  WHERE slug='hr-management';
UPDATE solutions SET name='Payroll', currency='KES',
  project_value_low=50000, project_value_base=75000, project_value_high=120000,
  features='Salary calculation,deductions,NHIF/NSSF/PAYE,statutory reports,payslips,payment files',
  demo_template='ts-payroll'
  WHERE slug='payroll-system';
UPDATE solutions SET name='E-commerce', currency='KES',
  project_value_low=90000, project_value_base=140000, project_value_high=250000,
  features='Online storefront,catalogue,cart,checkout,order notifications,payments,analytics',
  demo_template='ts-ecommerce'
  WHERE slug='ecommerce-store';
UPDATE solutions SET name='Wholesale Portal', currency='KES',
  project_value_low=110000, project_value_base=170000, project_value_high=300000,
  features='Password-protected portal,tiered pricing,self-service bulk ordering,credit limits,order status',
  demo_template='ts-wholesale'
  WHERE slug='wholesale-portal';
UPDATE solutions SET name='Order Management', currency='KES',
  project_value_low=80000, project_value_base=120000, project_value_high=200000,
  features='Central order pipeline,statuses,assignment,fulfilment tracking,multi-channel intake,dispatch notes',
  demo_template='ts-order-management'
  WHERE slug='order-management';
UPDATE solutions SET name='Delivery Management', currency='KES',
  project_value_low=70000, project_value_base=110000, project_value_high=190000,
  features='Dispatch board,rider assignment,delivery statuses,proof of delivery,distance & time tracking,cod reconciliation',
  demo_template='ts-delivery'
  WHERE slug='delivery-management';
UPDATE solutions SET name='M-Pesa Integration', currency='KES',
  project_value_low=45000, project_value_base=65000, project_value_high=110000,
  features='Auto matching of payments to orders/invoices,STK push,reconciliation reports,transaction ledger',
  demo_template='ts-mpesa'
  WHERE slug='mpesa-integration';
UPDATE solutions SET name='Customer Loyalty', currency='KES',
  project_value_low=40000, project_value_base=60000, project_value_high=100000,
  features='Points/stamps,repeat-visit rewards,tiered tiers,win-back offers,redemption tracking',
  demo_template='ts-loyalty'
  WHERE slug='customer-loyalty';
UPDATE solutions SET name='Quotation Management', currency='KES',
  project_value_low=45000, project_value_base=65000, project_value_high=110000,
  features='Professional quote builder,templates,approval flow,versioning,follow-up reminders,markup rules',
  demo_template='ts-quotation'
  WHERE slug='quotation-management';
UPDATE solutions SET name='Production Management', currency='KES',
  project_value_low=100000, project_value_base=150000, project_value_high=260000,
  features='Work orders,production stages,material usage,completion tracking,capacity planning,bill of materials',
  demo_template='ts-production'
  WHERE slug='production-management';
UPDATE solutions SET name='Appointment Management', currency='KES',
  project_value_low=40000, project_value_base=60000, project_value_high=95000,
  features='Staff calendars,queue management,reminders,no-show reduction,walk-in handling',
  demo_template='ts-appointments'
  WHERE slug='appointment-management';
UPDATE solutions SET name='Customer Support Desk', currency='KES',
  project_value_low=45000, project_value_base=65000, project_value_high=110000,
  features='Shared inbox,ticket tracking,response-time monitoring,canned replies,assignment',
  demo_template='ts-support'
  WHERE slug='customer-support-desk';
UPDATE solutions SET name='Business Analytics', currency='KES',
  project_value_low=55000, project_value_base=85000, project_value_high=150000,
  features='Automated daily/weekly reports,sales/stock/staff/channel KPIs,custom dashboards,export',
  demo_template='ts-analytics'
  WHERE slug='business-analytics';