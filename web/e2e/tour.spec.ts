import { expect, test, type Page } from "@playwright/test"

const card = (page: Page) => page.getByRole("dialog", { name: /Guided tour/ })
const step = (page: Page, n: number) => expect(card(page)).toContainText(`step ${n} of 7`)
const retconSwitch = (page: Page) => page.getByRole("switch", { name: "Retcon firewall" })

test("the guided tour walks through hijack, rollback and quarantine", async ({ page }) => {
  await page.goto("/play/shopping")
  await page.getByRole("button", { name: "Take the 1-minute tour" }).click()

  // 1. Turn Retcon off.
  await step(page, 1)
  await expect(card(page)).toBeFocused()
  await expect(card(page)).toHaveAttribute("aria-modal", "false")
  await expect(retconSwitch(page)).toHaveCSS("outline-style", "solid")
  await retconSwitch(page).click()
  await expect(retconSwitch(page)).toHaveAttribute("aria-checked", "false")

  // 2. The obvious attack is pre-filled; let the assistant read it.
  await step(page, 2)
  await expect(page.getByLabel("Content to read")).toHaveValue(/ignore previous instructions/i)
  await page.getByRole("button", { name: "Let the assistant read it" }).click()
  await expect(page.getByText("Stored", { exact: true })).toBeVisible()

  // 3. Ask for a refund.
  await step(page, 3)
  await page.getByRole("button", { name: "Please refund my order #A100." }).click()

  // 4. Hijacked: roll back the change that wrote the poisoned memory.
  await step(page, 4)
  const actions = page.getByRole("region", { name: "Actions" })
  await expect(actions.getByText("Hijacked")).toBeVisible()
  // The timeline is newest first, so the first match is the review's write (the highlighted one), not the seed.
  const rollbackBtn = page.getByRole("button", { name: /Roll back to before this: Saved refund_method/ }).first()
  await expect(rollbackBtn).toHaveCSS("outline-style", "solid")
  await rollbackBtn.click()
  const dialog = page.getByRole("dialog", { name: "Roll back to before this change?" })
  await expect(dialog.getByText("After rollback:").first()).toBeVisible()
  await dialog.getByRole("button", { name: "Confirm rollback" }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole("region", { name: "Timeline" }).getByText("Rolled back").first()).toBeVisible()
  await expect(page.getByText("Refunds go to the card ending 4242").first()).toBeVisible()

  // 5. Turn Retcon back on.
  await step(page, 5)
  await retconSwitch(page).click()
  await expect(retconSwitch(page)).toHaveAttribute("aria-checked", "true")

  // 6. Same review again.
  await step(page, 6)
  await expect(page.getByLabel("Content to read")).toHaveValue(/ignore previous instructions/i)
  await page.getByRole("button", { name: "Let the assistant read it" }).click()

  // 7. Blocked and quarantined; the refund stays safe.
  await step(page, 7)
  const quarantine = page.getByRole("region", { name: "Quarantine" })
  await expect(quarantine.getByText("Held", { exact: true })).toBeVisible()
  await expect(page.getByText("Quarantined", { exact: true })).toBeVisible()
  await card(page).getByRole("button", { name: "Finish" }).click()
  await expect(card(page)).toBeHidden()

  // The real UI still works afterwards, and the refund went to the safe card.
  await page.getByRole("button", { name: "Please refund my order #A100." }).click()
  await expect(page.getByText("Refunded order #A100 to the card ending 4242.").first()).toBeVisible()
})

test("the tour is offered once, can be skipped with Esc, and restarted from the header", async ({ page }) => {
  await page.goto("/play/shopping")
  await page.getByRole("button", { name: "Take the 1-minute tour" }).click()
  await step(page, 1)
  await page.keyboard.press("Escape")
  await expect(card(page)).toBeHidden()

  await page.reload()
  await expect(retconSwitch(page)).toBeVisible()
  await expect(page.getByRole("button", { name: "Take the 1-minute tour" })).toHaveCount(0)

  await page.getByRole("button", { name: "Tour", exact: true }).click()
  await step(page, 1)
  await card(page).getByRole("button", { name: "Skip tour" }).click()
  await expect(card(page)).toBeHidden()
})
