-- Add source column to revenue_cells (matches office_expense_cells pattern)
ALTER TABLE revenue_cells
  ADD COLUMN source TEXT DEFAULT 'manual'
  CHECK (source IN ('manual', 'api', 'projection'));
