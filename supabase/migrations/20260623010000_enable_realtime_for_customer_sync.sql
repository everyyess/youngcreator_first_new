-- Enable Realtime for tables that need to sync to the customer view
ALTER PUBLICATION supabase_realtime ADD TABLE customers;
ALTER PUBLICATION supabase_realtime ADD TABLE rebalancing_state;
ALTER PUBLICATION supabase_realtime ADD TABLE new_analysis_results;
ALTER PUBLICATION supabase_realtime ADD TABLE tax_summaries;
ALTER PUBLICATION supabase_realtime ADD TABLE product_selections;
