FROM atm-python-base:latest

WORKDIR /app

COPY app ./app
COPY db ./db

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]