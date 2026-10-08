/* Exercise the same disclosure as users before accessing backup controls. */
export async function ensureBackup(page) {
  const menu = page.locator('#backup-menu');
  if (!await menu.evaluate(node => node.open)) await menu.locator('summary').click();
}
