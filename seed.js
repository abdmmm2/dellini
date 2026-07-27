require('dotenv').config();
const { initializeDatabase, seedDatabase } = require('./database');

console.log('🌱 Seeding database...');
initializeDatabase();
seedDatabase();
console.log('✅ Done!');
