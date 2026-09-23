-- 002_seed_solutions.sql — Solution Library with problem + industry mappings.
-- These are the user's deliverable capabilities, not demo data.

INSERT INTO solutions (name, slug, description, active, minimum_project_value, maximum_project_value, currency) VALUES
('Point of Sale (POS)','point-of-sale','Fast, reliable in-store sales system with receipts, shifts, daily summaries and payment tracking.',1,1200,4500,'USD'),
('ERP System','erp-system','Integrated system connecting sales, purchasing, stock and accounting for established multi-department businesses.',1,8000,40000,'USD'),
('Inventory Management','inventory-management','Live stock levels, low-stock alerts, stock counts, shrinkage tracking and purchase suggestions.',1,1500,6000,'USD'),
('Booking System','booking-system','Online self-service appointment booking with reminders, calendars and staff schedules.',1,900,3500,'USD'),
('CRM','crm','Customer database, follow-up reminders, deal tracking and communication history.',1,1200,5000,'USD'),
('Restaurant Management','restaurant-management','Menu management, table service, kitchen tickets, waiter ordering and daily sales reconciliation.',1,2000,8000,'USD'),
('Hotel Management','hotel-management','Room availability, reservations, check-in/out, housekeeping status and occupancy reports.',1,2500,10000,'USD'),
('Clinic Management','clinic-management','Patient records, appointment queues, prescriptions and visit billing.',1,2500,9000,'USD'),
('School Management','school-management','Enrolment, attendance, fee tracking, parent communication and report cards.',1,3000,12000,'USD'),
('HR Management','hr-management','Employee records, leave requests, contracts and document management.',1,1500,6000,'USD'),
('Payroll System','payroll-system','Automated salary calculation, deductions, payslips and payment files.',1,1200,4500,'USD'),
('E-commerce Store','ecommerce-store','Online storefront with catalogue, cart, checkout, order notifications and basic analytics.',1,1800,7000,'USD'),
('Wholesale Portal','wholesale-portal','Password-protected portal where wholesale customers see tiered prices and place bulk orders themselves.',1,2500,9000,'USD'),
('Order Management System','order-management','Central pipeline for incoming orders from all channels with statuses, assignment and fulfilment tracking.',1,1600,6500,'USD'),
('Delivery Management','delivery-management','Dispatch board, rider assignment, delivery statuses and proof of delivery.',1,1500,6000,'USD'),
('M-Pesa Integration','mpesa-integration','Automatic matching of mobile-money payments to orders/invoices with reconciliation reports.',1,900,3200,'USD'),
('Customer Loyalty Program','customer-loyalty','Points/stamps, repeat-visit rewards and targeted win-back offers for existing customers.',1,800,2800,'USD'),
('Quotation Management','quotation-management','Professional quote builder with templates, approval flow, versioning and follow-up reminders.',1,1000,3800,'USD'),
('Production Management','production-management','Work orders, production stages, material usage and completion tracking against customer orders.',1,2200,8500,'USD'),
('Appointment Management','appointment-management','Staff calendars, queue management, reminders and no-show reduction for service businesses.',1,800,3000,'USD'),
('Customer Support Desk','customer-support-desk','Shared inbox, ticket tracking, response-time monitoring and canned replies for customer enquiries.',1,900,3600,'USD'),
('Business Analytics Dashboard','business-analytics','Automated daily/weekly reports on sales, stock, staff and channel performance in one view.',1,1100,4800,'USD')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO solution_problems (solution_id, problem_type)
SELECT s.id, p.problem_type FROM solutions s JOIN (
  SELECT 'point-of-sale' AS slug, 'lost_sales' AS problem_type UNION ALL
  SELECT 'point-of-sale', 'operational_inefficiency' UNION ALL
  SELECT 'point-of-sale', 'payment_reconciliation' UNION ALL
  SELECT 'point-of-sale', 'reporting' UNION ALL
  SELECT 'point-of-sale', 'administrative_inefficiency' UNION ALL
  SELECT 'erp-system', 'inventory_problems' UNION ALL
  SELECT 'erp-system', 'reporting' UNION ALL
  SELECT 'erp-system', 'operational_inefficiency' UNION ALL
  SELECT 'erp-system', 'multi_branch_management' UNION ALL
  SELECT 'erp-system', 'administrative_inefficiency' UNION ALL
  SELECT 'inventory-management', 'inventory_problems' UNION ALL
  SELECT 'inventory-management', 'lost_sales' UNION ALL
  SELECT 'inventory-management', 'production_tracking' UNION ALL
  SELECT 'booking-system', 'manual_booking' UNION ALL
  SELECT 'booking-system', 'scheduling' UNION ALL
  SELECT 'booking-system', 'poor_conversion' UNION ALL
  SELECT 'booking-system', 'customer_communication' UNION ALL
  SELECT 'crm', 'customer_retention' UNION ALL
  SELECT 'crm', 'customer_communication' UNION ALL
  SELECT 'crm', 'quotation_management' UNION ALL
  SELECT 'crm', 'poor_conversion' UNION ALL
  SELECT 'crm', 'repeat_sales' UNION ALL
  SELECT 'crm', 'customer_service' UNION ALL
  SELECT 'restaurant-management', 'operational_inefficiency' UNION ALL
  SELECT 'restaurant-management', 'lost_sales' UNION ALL
  SELECT 'restaurant-management', 'payment_reconciliation' UNION ALL
  SELECT 'restaurant-management', 'staff_management' UNION ALL
  SELECT 'hotel-management', 'manual_booking' UNION ALL
  SELECT 'hotel-management', 'scheduling' UNION ALL
  SELECT 'hotel-management', 'operational_inefficiency' UNION ALL
  SELECT 'hotel-management', 'reporting' UNION ALL
  SELECT 'clinic-management', 'manual_booking' UNION ALL
  SELECT 'clinic-management', 'scheduling' UNION ALL
  SELECT 'clinic-management', 'operational_inefficiency' UNION ALL
  SELECT 'clinic-management', 'customer_communication' UNION ALL
  SELECT 'school-management', 'staff_management' UNION ALL
  SELECT 'school-management', 'customer_communication' UNION ALL
  SELECT 'school-management', 'payment_reconciliation' UNION ALL
  SELECT 'school-management', 'reporting' UNION ALL
  SELECT 'hr-management', 'staff_management' UNION ALL
  SELECT 'hr-management', 'administrative_inefficiency' UNION ALL
  SELECT 'payroll-system', 'staff_management' UNION ALL
  SELECT 'payroll-system', 'payment_reconciliation' UNION ALL
  SELECT 'payroll-system', 'administrative_inefficiency' UNION ALL
  SELECT 'ecommerce-store', 'lost_sales' UNION ALL
  SELECT 'ecommerce-store', 'poor_conversion' UNION ALL
  SELECT 'ecommerce-store', 'customer_retention' UNION ALL
  SELECT 'ecommerce-store', 'repeat_sales' UNION ALL
  SELECT 'wholesale-portal', 'wholesale_ordering' UNION ALL
  SELECT 'wholesale-portal', 'manual_ordering' UNION ALL
  SELECT 'wholesale-portal', 'quotation_management' UNION ALL
  SELECT 'wholesale-portal', 'lost_sales' UNION ALL
  SELECT 'wholesale-portal', 'order_tracking' UNION ALL
  SELECT 'order-management', 'manual_ordering' UNION ALL
  SELECT 'order-management', 'order_tracking' UNION ALL
  SELECT 'order-management', 'production_tracking' UNION ALL
  SELECT 'order-management', 'operational_inefficiency' UNION ALL
  SELECT 'order-management', 'customer_service' UNION ALL
  SELECT 'delivery-management', 'delivery_management' UNION ALL
  SELECT 'delivery-management', 'scheduling' UNION ALL
  SELECT 'delivery-management', 'customer_communication' UNION ALL
  SELECT 'mpesa-integration', 'payment_reconciliation' UNION ALL
  SELECT 'mpesa-integration', 'operational_inefficiency' UNION ALL
  SELECT 'mpesa-integration', 'reporting' UNION ALL
  SELECT 'mpesa-integration', 'administrative_inefficiency' UNION ALL
  SELECT 'customer-loyalty', 'customer_retention' UNION ALL
  SELECT 'customer-loyalty', 'repeat_sales' UNION ALL
  SELECT 'customer-loyalty', 'poor_conversion' UNION ALL
  SELECT 'quotation-management', 'quotation_management' UNION ALL
  SELECT 'quotation-management', 'poor_conversion' UNION ALL
  SELECT 'quotation-management', 'lost_sales' UNION ALL
  SELECT 'quotation-management', 'administrative_inefficiency' UNION ALL
  SELECT 'production-management', 'production_tracking' UNION ALL
  SELECT 'production-management', 'order_tracking' UNION ALL
  SELECT 'production-management', 'operational_inefficiency' UNION ALL
  SELECT 'production-management', 'staff_management' UNION ALL
  SELECT 'appointment-management', 'scheduling' UNION ALL
  SELECT 'appointment-management', 'manual_booking' UNION ALL
  SELECT 'appointment-management', 'customer_service' UNION ALL
  SELECT 'customer-support-desk', 'customer_service' UNION ALL
  SELECT 'customer-support-desk', 'customer_communication' UNION ALL
  SELECT 'customer-support-desk', 'poor_conversion' UNION ALL
  SELECT 'business-analytics', 'reporting' UNION ALL
  SELECT 'business-analytics', 'operational_inefficiency' UNION ALL
  SELECT 'business-analytics', 'inventory_problems' UNION ALL
  SELECT 'business-analytics', 'multi_branch_management'
) p ON p.slug = s.slug
ON CONFLICT DO NOTHING;

INSERT INTO solution_industries (solution_id, industry)
SELECT s.id, i.industry FROM solutions s JOIN (
  SELECT 'restaurant-management' AS slug, 'Hospitality / restaurants' AS industry UNION ALL
  SELECT 'restaurant-management', 'Food & beverage' UNION ALL
  SELECT 'hotel-management', 'Hospitality / hotels' UNION ALL
  SELECT 'clinic-management', 'Healthcare' UNION ALL
  SELECT 'school-management', 'Education' UNION ALL
  SELECT 'wholesale-portal', 'Wholesale / distribution' UNION ALL
  SELECT 'production-management', 'Manufacturing' UNION ALL
  SELECT 'booking-system', 'Services' UNION ALL
  SELECT 'appointment-management', 'Healthcare' UNION ALL
  SELECT 'appointment-management', 'Services' UNION ALL
  SELECT 'delivery-management', 'Logistics / delivery' UNION ALL
  SELECT 'delivery-management', 'Retail' UNION ALL
  SELECT 'mpesa-integration', 'Retail' UNION ALL
  SELECT 'mpesa-integration', 'Wholesale / distribution' UNION ALL
  SELECT 'mpesa-integration', 'Services'
) i ON i.slug = s.slug
ON CONFLICT DO NOTHING;