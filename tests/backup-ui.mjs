/* Exercise the same disclosure as users before accessing backup controls. */
export async function ensureBackup(page) {
  const menu = page.locator('#backup-menu');
  if (!await menu.evaluate(node => node.open && node.querySelector('.backup-panel').dataset.motion !== 'closing')) await menu.locator('summary').click();
}

export async function openAnnotationData(page) {
  await ensureBackup(page);
  await page.locator('#data-button').click();
}
