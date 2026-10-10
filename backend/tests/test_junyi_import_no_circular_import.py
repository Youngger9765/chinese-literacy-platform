def test_service_module_imports_standalone_without_circular_import():
    import importlib
    import sys
    for mod_name in list(sys.modules):
        if mod_name in (
            "app.services.junyi_class_import_service",
            "app.routes.classrooms",
            "app.routes.classrooms.classroom_junyi_import",
            "app.routes.classrooms.helpers",
        ):
            del sys.modules[mod_name]
    mod = importlib.import_module("app.services.junyi_class_import_service")
    assert hasattr(mod, "import_junyi_classes")
