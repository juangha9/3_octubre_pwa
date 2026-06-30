-- Permite que admin_grifo también pueda modificar app_config
-- (antes solo superadmin tenía acceso de escritura)
DROP POLICY IF EXISTS "app_config_write" ON app_config;
CREATE POLICY "app_config_write" ON app_config
  FOR ALL USING (get_my_role() IN ('admin_grifo', 'superadmin'));
