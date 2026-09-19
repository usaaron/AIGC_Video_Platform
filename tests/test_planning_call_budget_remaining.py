"""Remaining-call queries observe shared state and never reserve allowance."""

from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import event, update
from sqlmodel import select

from app.database import create_database_runtime
from app.document_repository import ModuleDocumentRecord
from app.modules.script_engine.planning_call_budget import (
    PLANNING_CALL_BUDGET_NAMESPACE, PlanningCallBudget, PlanningCallBudgetExceeded,
    planning_call_budget_scope, remaining_planning_model_requests,
)
from tests.test_planning_call_budget import binding, runtime


def test_remaining_without_scope_is_unknown():
    assert remaining_planning_model_requests() is None


def test_remaining_reads_latest_durable_state_without_any_write(runtime):
    settings = binding(runtime)
    reader = PlanningCallBudget(**settings)
    statements = []

    def trace(_connection, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    event.listen(runtime.engine, "before_cursor_execute", trace)
    try:
        assert reader.remaining() == 4
        assert reader.remaining() == 4
    finally:
        event.remove(runtime.engine, "before_cursor_execute", trace)
    assert statements and all(sql.lstrip().upper().startswith("SELECT") for sql in statements)
    with runtime.session() as session:
        assert session.exec(select(ModuleDocumentRecord).where(
            ModuleDocumentRecord.namespace == PLANNING_CALL_BUDGET_NAMESPACE,
        )).all() == []

    # A distinct runtime simulates another HTTP worker/process updating storage.
    writer_runtime = create_database_runtime(str(runtime.engine.url))
    try:
        writer = PlanningCallBudget(**(settings | {"database_runtime": writer_runtime}))
        for expected in (3, 2, 1, 0):
            writer.charge()
            assert reader.remaining() == expected
        with planning_call_budget_scope(**settings):
            assert remaining_planning_model_requests() == 0
        assert reader.remaining() == 0
        with pytest.raises(PlanningCallBudgetExceeded):
            reader.charge()
    finally:
        writer_runtime.engine.dispose()


def test_remaining_memory_state_survives_scope_and_never_expands_limit():
    settings = binding(None, operation_id=str(uuid4()), limit=2)
    with planning_call_budget_scope(**settings) as first:
        assert remaining_planning_model_requests() == 2
        first.charge()
    with planning_call_budget_scope(**(settings | {"limit": 4})) as resumed:
        assert remaining_planning_model_requests() == 1
        assert first.remaining() == 1
        resumed.charge()
        assert first.remaining() == 0
        assert remaining_planning_model_requests() == 0
        with pytest.raises(PlanningCallBudgetExceeded):
            resumed.charge()
    assert remaining_planning_model_requests() is None


@pytest.mark.parametrize("mutation", [
    {"binding": {"project_id": "wrong-project"}},
    {"limit": 0}, {"limit": 5}, {"limit": "4"},
    {"used": -1}, {"used": 5}, {"used": True},
])
def test_remaining_rejects_corrupt_binding_or_allowance_without_modifying_record(runtime, mutation):
    budget = PlanningCallBudget(**binding(runtime))
    budget.charge()
    with runtime.session() as session:
        row = session.exec(select(ModuleDocumentRecord).where(
            ModuleDocumentRecord.namespace == PLANNING_CALL_BUDGET_NAMESPACE,
            ModuleDocumentRecord.document_id == budget.document_id,
        )).one()
        corrupted = deepcopy(row.payload) | mutation
        session.execute(update(ModuleDocumentRecord).where(
            ModuleDocumentRecord.namespace == PLANNING_CALL_BUDGET_NAMESPACE,
            ModuleDocumentRecord.document_id == budget.document_id,
        ).values(payload=corrupted))
    with pytest.raises(RuntimeError, match="binding mismatch|invalid usage or limit"):
        budget.remaining()
    with runtime.session() as session:
        row = session.exec(select(ModuleDocumentRecord).where(
            ModuleDocumentRecord.namespace == PLANNING_CALL_BUDGET_NAMESPACE,
            ModuleDocumentRecord.document_id == budget.document_id,
        )).one()
        assert row.payload == corrupted
