const fs = require('fs');
const dump = JSON.parse(fs.readFileSync('supabase_schema_dump.json', 'utf8'));

console.log('=== PUBLIC TABLES & COLUMNS ===');
Object.keys(dump.schema).forEach(table => {
    console.log(`\nTable: public.${table} (${dump.schema[table].length} columns)`);
    dump.schema[table].forEach(col => {
        const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
        const def = col.column_default ? ` DEFAULT ${col.column_default}` : '';
        console.log(`  - ${col.column_name}: ${col.data_type} (${col.udt_name}) ${nullable}${def}`);
    });
});

console.log('\n=== PRIMARY & FOREIGN KEY CONSTRAINTS ===');
dump.constraints.forEach(c => {
    if (c.constraint_type === 'PRIMARY KEY') {
        console.log(`[PK] ${c.table_name}.${c.column_name} (${c.constraint_name})`);
    } else if (c.constraint_type === 'FOREIGN KEY') {
        console.log(`[FK] ${c.table_name}.${c.column_name} -> ${c.foreign_table_name}.${c.foreign_column_name} (${c.constraint_name})`);
    } else if (c.constraint_type === 'UNIQUE') {
        console.log(`[UQ] ${c.table_name}.${c.column_name} (${c.constraint_name})`);
    }
});

console.log('\n=== ROW LEVEL SECURITY (RLS) POLICIES ===');
console.log(`Total policies: ${dump.policies.length}`);
dump.policies.forEach(p => {
    console.log(`  - [${p.tablename}] "${p.policyname}" FOR ${p.cmd} TO ${p.roles}`);
});

console.log('\n=== TRIGGERS ===');
console.log(`Total triggers: ${dump.triggers.length}`);
dump.triggers.forEach(t => {
    console.log(`  - [${t.event_object_table}] ${t.trigger_name} ${t.action_timing} ${t.event_manipulation}`);
});

