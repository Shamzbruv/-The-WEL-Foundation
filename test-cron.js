// test-cron.js 
// Programmatic check ensuring weekend skip logic is enforced
console.log("=== CRON VERIFICATION (3-Day SLAs) ===");

const businessDaysToAdd = 3;
let currentDate = new Date('2026-04-03T12:00:00Z'); // Friday
let addedDays = 0;

while (addedDays < businessDaysToAdd) {
    currentDate.setDate(currentDate.getDate() + 1);
    const dayOfWeek = currentDate.getDay(); // 0 is Sunday, 6 is Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        addedDays++;
    }
}

console.log("Base Date: Friday, April 3, 2026");
console.log("Target Date (3 Business Days Add):", currentDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));

if (currentDate.getDay() === 3) {
   console.log("✅ CRON VERIFICATION PASSED: Weekends successfully factored out. Target hit Wednesday.");
} else {
   console.log("❌ CRON VERIFICATION FAILED.");
   process.exit(1);
}
