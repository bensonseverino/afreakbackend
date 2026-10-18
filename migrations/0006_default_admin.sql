-- AFREAK default CMS owner.
-- Login: owner@afreak.com / afreak-dev-admin-1
-- The password hash is PBKDF2-SHA256 (100k iterations, 16-byte salt) produced by
-- `server/lib/password.ts`. Change the password from Settings in the CMS; this
-- migration only runs once, so the change sticks.
--
-- If an account with this email already exists it is reset to the default
-- password, which makes the credentials work on databases that were set up
-- before this migration.
INSERT INTO admins (id, email, name, role, password_hash, salt)
VALUES (
  'adm_default_owner',
  'owner@afreak.com',
  NULL,
  'owner',
  '0667c7362a8c7be3c6a2e740b96c9660aae917241fd3d785ed0bea2ea3415bfc',
  'c3ec5405c94d616288987868ba0b4e9c'
)
ON CONFLICT(email) DO UPDATE SET
  password_hash = excluded.password_hash,
  salt = excluded.salt,
  role = 'owner';
