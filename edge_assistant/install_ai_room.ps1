python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install cmake
pip install dlib
pip install pipwin
pipwin install pyaudio
pip install -r requirements.txt
Write-Host "✅ Done"
Write-Host "Next steps:"
Write-Host "1) Edit .env and set ESP32_IP, MQTT credentials, TELEGRAM_TOKEN/CHAT_ID"
Write-Host "2) Place my_face.jpg at edge_assistant/my_face.jpg"
Write-Host "3) Place alarm.mp3 at edge_assistant/alarm.mp3"
Write-Host "4) uvicorn app.main:app --host 0.0.0.0 --port 8088 --reload"
Write-Host "5) python run_workers.py"
