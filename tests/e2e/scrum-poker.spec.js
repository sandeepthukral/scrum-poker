const { test, expect } = require('@playwright/test');

// Creates a room and returns the room ID
async function createRoom(page, name) {
  await page.goto('/');
  await page.fill('#create-name', name);
  await page.click('#create-btn');
  await page.waitForURL(/[?&]room=/);
  return new URL(page.url()).searchParams.get('room');
}

// Joins an existing room via the Join tab
async function joinRoom(page, roomId, name) {
  await page.goto('/');
  await page.click('[data-tab="join"]');
  await page.fill('#join-room-id', roomId);
  await page.fill('#join-name', name);
  await page.click('#join-btn');
  await page.waitForURL(/[?&]room=/);
}

test.describe('Scrum Poker — multi-user flows', () => {

  test('two users can join a room and see each other', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      const roomId = await createRoom(pageA, 'Alice');
      await joinRoom(pageB, roomId, 'Bob');

      await expect(pageA.locator('#participant-count')).toHaveText('2 participants');
      await expect(pageB.locator('#participant-count')).toHaveText('2 participants');
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('voted users show a check mark to others before reveal', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      const roomId = await createRoom(pageA, 'Alice');
      await joinRoom(pageB, roomId, 'Bob');

      await pageA.locator('.card[data-val="5"]').click();

      // Bob sees Alice voted (✓) but not the value
      await expect(pageB.locator('#results-body .vote-badge.voted')).toBeVisible();
      await expect(pageB.locator('#results-body .vote-badge.revealed')).not.toBeVisible();
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('owner reveals cards — both users see votes and stats', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      const roomId = await createRoom(pageA, 'Alice');
      await joinRoom(pageB, roomId, 'Bob');

      await pageA.locator('.card[data-val="5"]').click();
      await pageB.locator('.card[data-val="8"]').click();
      await pageA.locator('#reveal-btn').click();

      await expect(pageA.locator('#stats-bar')).not.toHaveClass(/hidden/);
      await expect(pageB.locator('#stats-bar')).not.toHaveClass(/hidden/);
      await expect(pageA.locator('#stat-min')).toHaveText('5');
      await expect(pageA.locator('#stat-max')).toHaveText('8');
      await expect(pageA.locator('#stat-consensus')).toHaveText('✗ No');
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('outlier highlighting — low voter gets outlier-low, high voters get outlier-high', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const ctxC = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();
      const pageC = await ctxC.newPage();

      const roomId = await createRoom(pageA, 'Alice');
      await joinRoom(pageB, roomId, 'Bob');
      await joinRoom(pageC, roomId, 'Carol');

      await pageA.locator('.card[data-val="2"]').click();
      await pageB.locator('.card[data-val="8"]').click();
      await pageC.locator('.card[data-val="8"]').click();
      await pageA.locator('#reveal-btn').click();

      await expect(pageA.locator('#results-body .name-outlier.outlier-low')).toContainText('Alice');
      await expect(pageA.locator('#results-body .name-outlier.outlier-high').first()).toBeVisible();
    } finally {
      await ctxA.close();
      await ctxB.close();
      await ctxC.close();
    }
  });

  test('consensus — all vote the same, stat shows Yes', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      const roomId = await createRoom(pageA, 'Alice');
      await joinRoom(pageB, roomId, 'Bob');

      await pageA.locator('.card[data-val="5"]').click();
      await pageB.locator('.card[data-val="5"]').click();
      await pageA.locator('#reveal-btn').click();

      await expect(pageA.locator('#stat-consensus')).toHaveText('✓ Yes');
      await expect(pageB.locator('#stat-consensus')).toHaveText('✓ Yes');
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('non-owner reveal button is disabled', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      const roomId = await createRoom(pageA, 'Alice');
      await joinRoom(pageB, roomId, 'Bob');

      await expect(pageB.locator('#reveal-btn')).toBeDisabled();
      // Stats should not appear
      await expect(pageA.locator('#stats-bar')).toHaveClass(/hidden/);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('ownership transfers when owner closes — new owner can reveal', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      const roomId = await createRoom(pageA, 'Alice');
      await joinRoom(pageB, roomId, 'Bob');

      await expect(pageB.locator('#reveal-btn')).toBeDisabled();

      await ctxA.close();

      await expect(pageB.locator('#reveal-btn')).toBeEnabled();
    } finally {
      await ctxB.close();
    }
  });

  test('owner can transfer organizer role to another member', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      const roomId = await createRoom(pageA, 'Alice');
      await joinRoom(pageB, roomId, 'Bob');

      // Alice sees a "Make organizer" button for Bob (visible on hover)
      const makeOrgBtn = pageA.locator('.make-organizer-btn');
      await expect(makeOrgBtn).toBeAttached();

      // Alice clicks "Make organizer" for Bob
      await makeOrgBtn.click({ force: true });

      // Bob becomes organizer — his reveal button is now enabled
      await expect(pageB.locator('#reveal-btn')).toBeEnabled();

      // Alice is no longer organizer — her reveal button is disabled
      await expect(pageA.locator('#reveal-btn')).toBeDisabled();
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('owner can reset estimates — votes and stats clear for all users', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      const roomId = await createRoom(pageA, 'Alice');
      await joinRoom(pageB, roomId, 'Bob');

      await pageA.locator('.card[data-val="5"]').click();
      await pageB.locator('.card[data-val="8"]').click();
      await pageA.locator('#reveal-btn').click();
      await expect(pageA.locator('#stats-bar')).not.toHaveClass(/hidden/);

      await pageA.locator('#delete-btn').click();

      await expect(pageA.locator('#stats-bar')).toHaveClass(/hidden/);
      await expect(pageB.locator('#stats-bar')).toHaveClass(/hidden/);
      await expect(pageA.locator('#results-body .vote-badge.waiting').first()).toBeVisible();
      await expect(pageB.locator('#results-body .vote-badge.waiting').first()).toBeVisible();
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

});
