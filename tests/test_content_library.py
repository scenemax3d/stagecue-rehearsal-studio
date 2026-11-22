import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from installer import content_library as lib


class FolderLibraryTests(unittest.TestCase):
    def test_catalog_publish_preserves_old_scene_on_failure_or_stale_save(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(lib, "ROOT", Path(folder)):
            state = {"revision": 0, "scripts": [{"showId": "script", "title": "First"}],
                     "removed": [], "deletedDefaults": []}
            self.assertEqual(lib.save(state, None), 1)
            current = lib.catalog()
            first = lib.snapshot(current)
            with self.assertRaises(ValueError):
                lib.save(state, current)
            state.update(revision=1, scripts=[{"showId": "script", "title": "Edited"}])
            write = lib.write_file
            def fail_commit(path, data):
                if path.name == "catalog.json":
                    raise OSError("write interrupted")
                write(path, data)
            with patch.object(lib, "write_file", fail_commit), self.assertRaises(OSError):
                lib.save(state, current)
            self.assertEqual(lib.snapshot(lib.catalog()), first)
            lib.save(state, current)
            self.assertEqual(lib.snapshot(lib.catalog())["scripts"], state["scripts"])

    def test_media_locations_are_scoped_and_case_distinct(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(lib, "ROOT", Path(folder)):
            original = lib.media_path("id", "assets/pictures/stage.jpg")
            self.assertTrue(original.is_relative_to(lib.ROOT))
            self.assertEqual(original.name, "stage.jpg")
            self.assertNotEqual(original, lib.media_path("id", "assets/pictures/Stage.jpg"))
            with self.assertRaises(ValueError):
                lib.media_path("id", "assets/../catalog.json")
