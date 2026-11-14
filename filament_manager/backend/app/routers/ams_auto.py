"""Log of silent AMS spool assignments (see app/ams_autoassign.py).

GET    /api/ams-auto                   entries (newest last); the dashboard shows those with state "new"
POST   /api/ams-auto/{id}/undo         take the spool out of the slot again; never repeated for that colour
POST   /api/ams-auto/{id}/dismiss      hide the entry (the assignment stays)
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import ams_autoassign
from ..database import get_db

router = APIRouter(prefix="/api/ams-auto", tags=["ams-auto"])


@router.get("")
def list_entries(db: Session = Depends(get_db)):
    return ams_autoassign.get_log(db)


@router.post("/{entry_id}/undo")
def undo(entry_id: str, db: Session = Depends(get_db)):
    entry = ams_autoassign.set_state(db, entry_id, ams_autoassign.UNDONE)
    if entry is None:
        raise HTTPException(404, "Entry not found")
    return entry


@router.post("/{entry_id}/dismiss")
def dismiss(entry_id: str, db: Session = Depends(get_db)):
    entry = ams_autoassign.set_state(db, entry_id, ams_autoassign.SEEN)
    if entry is None:
        raise HTTPException(404, "Entry not found")
    return entry
