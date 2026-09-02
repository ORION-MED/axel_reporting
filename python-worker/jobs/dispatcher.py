from jobs.profile import handle_profile_job
from jobs.process import handle_process_job


def dispatch(job: dict):
    job_type = job.get("job_type")

    if job_type == "profile":
        handle_profile_job(job)
    elif job_type == "process":
        handle_process_job(job)
    else:
        raise ValueError(f"Неизвестный тип задачи: {job_type}")
