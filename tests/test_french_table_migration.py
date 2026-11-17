"""Opt-in PostgreSQL migration test; creates and removes its own database."""

import os
from pathlib import Path
import secrets
import unittest
from unittest.mock import patch

import psycopg2
from psycopg2 import sql
from psycopg2.extensions import make_dsn, parse_dsn

from app.core.config import settings
from db.seed import seed_demo_data


ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(os.environ.get("TEST_FRENCH_TABLE_MIGRATION") == "true", "Requires permission to create a disposable PostgreSQL database.")
class FrenchTableMigrationTests(unittest.TestCase):
    def test_rename_and_rollback_preserve_database_objects_and_data(self):
        parameters = parse_dsn(settings.database_url.replace("postgresql+psycopg2://", "postgresql://", 1))
        database_name = "test_tables_fr_" + secrets.token_hex(6)
        administration = psycopg2.connect(**parameters)
        administration.autocommit = True
        connection = None
        created = False
        try:
            with administration.cursor() as cursor:
                cursor.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name)))
                created = True
            connection = psycopg2.connect(**{**parameters, "dbname": database_name})
            connection.autocommit = True
            with connection.cursor() as cursor:
                for migration in sorted((ROOT / "db/migrations").glob("*.sql")):
                    if migration.name.startswith("0019_"):
                        continue
                    cursor.execute(migration.read_text())
                cursor.execute("""
                    CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY);
                    INSERT INTO technician (full_name) VALUES ('Migration test');
                    INSERT INTO main_app.accounts (technician_id, username, password_hash, role)
                    VALUES (1, 'migration_test', 'unchanged-test-hash', 'admin');
                """)
                cursor.execute("""
                    SELECT c.oid, n.nspname, c.relname, c.relacl::text, c.relowner
                    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname IN ('public', 'main_app') AND c.relkind IN ('r', 'S')
                    ORDER BY c.oid
                """)
                before = cursor.fetchall()
                cursor.execute("SELECT oid, conrelid, confrelid, conkey, confkey FROM pg_constraint ORDER BY oid")
                constraints = cursor.fetchall()
                cursor.execute((ROOT / "db/migrations/0019_table_names_french.sql").read_text())
                cursor.execute("""
                    SELECT c.oid, n.nspname, c.relname, c.relacl::text, c.relowner
                    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname IN ('public', 'main_app') AND c.relkind IN ('r', 'S')
                    ORDER BY c.oid
                """)
                after = cursor.fetchall()
                self.assertEqual([(r[0], r[1], r[3], r[4]) for r in before], [(r[0], r[1], r[3], r[4]) for r in after])
                cursor.execute("SELECT oid, conrelid, confrelid, conkey, confkey FROM pg_constraint ORDER BY oid")
                self.assertEqual(cursor.fetchall(), constraints)
                cursor.execute("SELECT full_name, password_hash FROM public.technicien JOIN main_app.comptes USING (technician_id)")
                self.assertEqual(cursor.fetchall(), [("Migration test", "unchanged-test-hash")])
                cursor.execute("INSERT INTO technicien (full_name) VALUES ('Sequence test') RETURNING technician_id")
                self.assertEqual(cursor.fetchone()[0], 2)
                cursor.execute("INSERT INTO schema_migrations VALUES ('0019_table_names_french.sql')")
                cursor.execute((ROOT / "db/rollback/0019_table_names_french.sql").read_text())
                cursor.execute("SELECT count(*) FROM schema_migrations")
                self.assertEqual(cursor.fetchone()[0], 0)
                cursor.execute("SELECT full_name FROM technician ORDER BY technician_id")
                self.assertEqual(cursor.fetchall(), [("Migration test",), ("Sequence test",)])
                cursor.execute((ROOT / "db/migrations/0019_table_names_french.sql").read_text())
                cursor.execute("SELECT count(*) FROM main_app.comptes")
                self.assertEqual(cursor.fetchone()[0], 1)
            # Validate every seed SQL statement and legacy sequence name, without an AI call.
            with patch.object(settings, "database_url", make_dsn(**{**parameters, "dbname": database_name})):
                with patch.object(seed_demo_data, "generate_embeddings_batch", side_effect=lambda texts: [[0.0] * 1024 for _ in texts]) as embeddings:
                    seed_demo_data.run_seed()
                    seed_demo_data.run_seed()
                    self.assertEqual(embeddings.call_count, 1)
        finally:
            if connection:
                connection.close()
            if created:
                with administration.cursor() as cursor:
                    cursor.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(database_name)))
            administration.close()
