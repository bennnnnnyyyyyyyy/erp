$Endpoint = "api.anthropic.com"
$Port = 443

Write-Host "=== Starting Claude API Network Diagnostics ===" -ForegroundColor Cyan

# 1. Test DNS Resolution
Write-Host "`n[1/3] Testing DNS Resolution for $Endpoint..." -NoNewline
try {
    $Dns = Resolve-DnsName -Name $Endpoint -ErrorAction Stop
    Write-Host " SUCCESS" -ForegroundColor Green
    $Dns | Select-Object Name, IPAddress | Format-Table | Out-String | Write-Host
}
catch {
    Write-Host " FAILED" -ForegroundColor Red
    Write-Warning "Could not resolve domain name. Check your DNS / Firewall routing."
}

# 2. Test TCP Port Connectivity
Write-Host "[2/3] Testing TCP Port $Port Connectivity..." -NoNewline
$TcpTest = Test-NetConnection -ComputerName $Endpoint -Port $Port -WarningAction SilentlyContinue
if ($TcpTest.TcpTestSucceeded) {
    Write-Host " SUCCESS" -ForegroundColor Green
}
else {
    Write-Host " FAILED" -ForegroundColor Red
    Write-Warning "Port 443 is blocked. Ensure outbound HTTPS traffic is allowed."
}

# 3. Test HTTP Handshake / SSL Connection
Write-Host "[3/3] Sending test HTTP request to API..." -NoNewline
try {
    $Response = Invoke-WebRequest -Uri "https://$Endpoint/v1/messages" -Method Post -Body "{}" -ContentType "application/json" -ErrorAction Stop
}
catch {
    if ($_.Exception.Response) {
        $StatusCode = $_.Exception.Response.StatusCode.value__
        if ($StatusCode -eq 401) {
            Write-Host " SUCCESS (Reached API safely)" -ForegroundColor Green
            Write-Host "Network Path Clear: Connected to Anthropic servers successfully (401 Unauthorized expected without an API key)." -ForegroundColor Green
        }
        else {
            Write-Host " FAILED (Status Code: $StatusCode)" -ForegroundColor Red
            Write-Warning $_.Exception.Message
        }
    }
    else {
        Write-Host " FAILED (No response from server)" -ForegroundColor Red
        Write-Warning $_.Exception.Message
    }
}
