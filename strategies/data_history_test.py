from openalgo import api

# Initialize the API client
client = api(api_key='b58d52652534d69b896466992175f3d4bffc8a0776811fdaa9fdf4eb0eeae9ba', host='http://127.0.0.1:5000')

# Fetch historical data for BHEL
df = client.history(
    symbol="NIFTY",
    exchange="NSE_INDEX",
    interval="D",
    start_date="2025-01-01",
    end_date="2025-09-31"
)

# Display the fetched data
print(df)

# print(type(df))
# print(df.shape)
# print(df.index)

# print(df.head())
# print(df.columns)
