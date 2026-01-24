const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

async function wipe() {
    const dbPath = path.join(__dirname, 'database.sqlite');
    console.log('Wiping database at:', dbPath);

    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    await db.exec('DELETE FROM trades');
    await db.exec('DELETE FROM signals');
    await db.exec("DELETE FROM sqlite_sequence WHERE name='signals' OR name='trades'");

    console.log('Database wiped successfully. Old mock signals are gone.');
    await db.close();
}

wipe().catch(err => console.error(err));
