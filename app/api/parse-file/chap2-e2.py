x = 5
print(x == 5)       # x == 5 → 5 equals 5 → True
print(x != 10)      # x != 10 → 5 is not 10 → True
print(x < 3)        # x < 3 → 5 is not less than 3 → False
print(x > 7)        # x > 7 → 5 is not greater than 7 → False
print(x <= 5)       # x <= 5 → 5 is less than or equal to 5 → True
print(x >= 5)       # x >= 5 → 5 is greater than or equal to 5 → True


x = 5
print(1 < x < 10)

# Python evaluates this as:
# 1 < x and x < 10
# Since 1 < 5 < 10 is true → result is True